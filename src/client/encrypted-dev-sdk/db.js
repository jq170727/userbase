import uuidv4 from 'uuid/v4'
import server from './server'
import Worker from './worker.js'
import auth from './auth'
import crypto from './Crypto'
import stateManager from './stateManager'
import { appendBuffers } from './Crypto/utils'
import { getSecondsSinceT0 } from './utils'

const wrapInAuthenticationErrorCatcher = async (promise) => {
  try {
    const response = await promise
    return response
  } catch (e) {
    const unauthorized = e.response && e.response.status === 401
    if (unauthorized) auth.clearAuthenticatedDataFromBrowser()
    throw e
  }
}

/**

    Webworker runs to determine if user's transaction log size
    is above the limit and bundles it to S3 if so. This is
    called after every write to the server.

 */
const initializeBundlingProcess = async (key) => {
  const worker = new Worker()
  if (!key) key = await auth.getKeyFromLocalStorage() // can't read local storage from worker
  worker.postMessage(key)
}

/**

    Takes an item as input, encrypts the item client-side,
    then sends the encrypted item to the database for storage.

    Returns the item id, a GUID generated by the client.

    Example call:

      const item = { todo: 'Remember the milk' }
      const itemId = await db.insert(item)

      console.log(itemId) // '50bf2e6e-9776-441e-8215-08966581fcec'

 */
const insert = async (item) => {
  const key = await auth.getKeyFromLocalStorage()
  const encryptedItem = await crypto.aesGcm.encrypt(key, item)

  const itemId = uuidv4()

  await wrapInAuthenticationErrorCatcher(
    server.db.insert(itemId, encryptedItem)
  )

  initializeBundlingProcess(key)

  return itemId
}

const batchInsert = async (items) => {
  const key = await auth.getKeyFromLocalStorage()
  const encryptionPromises = items.map(item => crypto.aesGcm.encrypt(key, item))
  const encryptedItems = await Promise.all(encryptionPromises)

  const { buffer, byteLengths } = appendBuffers(encryptedItems)

  const itemsMetadata = items.map((item, i) => ({
    itemId: uuidv4(),
    byteLength: byteLengths[i]
  }))

  await wrapInAuthenticationErrorCatcher(
    server.db.batchInsert(itemsMetadata, buffer)
  )

  initializeBundlingProcess(key)

  return itemsMetadata.map(itemMetadata => itemMetadata.itemId)
}

/**

    Takes the item id and updated item as inputs, encrypts the new
    item client-side, then sends the encrypted item along
    with the item id to the database for storage.

    Example call:

      const item = { todo: 'Remember the milk' }
      const itemId = await db.insert(item)

      item.completed = true
      await db.update(itemId, item)

      // The item now looks like this:
      //
      //    {
      //      todo: 'Remember the milk',
      //      completed: true
      //    }
      //

 */
const update = async (itemId, item) => {
  const key = await auth.getKeyFromLocalStorage()
  const encryptedItem = await crypto.aesGcm.encrypt(key, item)

  await wrapInAuthenticationErrorCatcher(
    server.db.update(itemId, encryptedItem)
  )

  initializeBundlingProcess(key)
}

const batchUpdate = async (itemIds, items) => {
  const key = await auth.getKeyFromLocalStorage()
  const encryptionPromises = items.map(item => crypto.aesGcm.encrypt(key, item))
  const encryptedItems = await Promise.all(encryptionPromises)

  const { buffer, byteLengths } = appendBuffers(encryptedItems)

  const updatedItemsMetadata = itemIds.map((item, index) => ({
    itemId: item['item-id'],
    byteLength: byteLengths[index]
  }))

  await wrapInAuthenticationErrorCatcher(
    server.db.batchUpdate(updatedItemsMetadata, buffer)
  )

  initializeBundlingProcess(key)
}

/**

    Deletes the item associated with the provided id.

    Example call:

      const item = { todo: 'Remember the milk' }
      const itemId = await db.insert(item)

      await db.delete(itemId)

 */
const deleteFunction = async (itemId) => {
  await wrapInAuthenticationErrorCatcher(
    server.db.delete(itemId)
  )

  initializeBundlingProcess()
}

const batchDelete = async (itemIds) => {
  await wrapInAuthenticationErrorCatcher(
    server.db.batchDelete(itemIds)
  )

  initializeBundlingProcess()
}

const setupClientState = async (transactionLog, encryptedDbState) => {
  const key = await auth.getKeyFromLocalStorage()

  const dbState = encryptedDbState
    ? await crypto.aesGcm.decrypt(key, encryptedDbState)
    : {
      itemsInOrderOfInsertion: stateManager.getItems(),
      itemIdsToOrderOfInsertion: stateManager.getItemIdsToIndexes(),
      maxSequenceNo: stateManager.getMaxSequenceNo()
    }


  debugger
  const {
    itemsInOrderOfInsertion,
    itemIdsToOrderOfInsertion,
    maxSequenceNo
  } = await stateManager.applyTransactionsToDbState(key, dbState, transactionLog)

  debugger

  stateManager.setState(itemsInOrderOfInsertion, itemIdsToOrderOfInsertion, maxSequenceNo)
}

const getFilterFunctionThatUsesIterator = (arr) => {
  return function (cb, thisArg) {
    const result = []
    let index = 0
    cb.bind(thisArg)
    for (const a of arr) {
      if (cb(a, index, arr)) result.push(a)
      index++
    }
    return result
  }
}

const getMapFunctionThatUsesIterator = (arr) => {
  return function (cb, thisArg) {
    const result = []
    let index = 0
    cb.bind(thisArg)
    for (const a of arr) {
      result.push(cb(a, index, arr))
      index++
    }
    return result
  }
}

const getIteratorToSkipDeletedItems = (itemsInOrderOfInsertion) => {
  return function () {
    return {
      current: 0,
      last: itemsInOrderOfInsertion.length - 1,

      next() {
        let item = itemsInOrderOfInsertion[this.current]
        let itemIsDeleted = !item

        while (itemIsDeleted && this.current < this.last) {
          this.current++
          item = itemsInOrderOfInsertion[this.current]
          itemIsDeleted = !item
        }

        if (this.current < this.last || (this.current === this.last && !itemIsDeleted)) {
          this.current++
          return { done: false, value: item }
        } else {
          return { done: true }
        }
      }
    }
  }
}

const setIteratorsToSkipDeletedItems = (itemsInOrderOfInsertion) => {
  itemsInOrderOfInsertion[Symbol.iterator] = getIteratorToSkipDeletedItems(itemsInOrderOfInsertion)

  // hacky solution to overwrite some native Array functions. All other native Array functions
  // remain unaffected
  itemsInOrderOfInsertion.map = getMapFunctionThatUsesIterator(itemsInOrderOfInsertion)
  itemsInOrderOfInsertion.filter = getFilterFunctionThatUsesIterator(itemsInOrderOfInsertion)
}

/**

    Returns the latest state of all items in the db in the order they
    were originally inserted.

    If an item has been updated, the most recent version of the item
    is included in the state.

    If an item has been deleted, it's possible that it will still
    show up in the result as an undefined element.

    For example, after the following sequence of actions:

      const milk = await db.insert({ todo: 'remember the milk' })
      const orangeJuice = await db.insert({ todo: 'buy orange juice' })
      await db.insert({ todo: 'create the most useful app of all time' })
      await db.delete(orangeJuice)
      await db.update(milk, { todo: milk.record.todo, completed: true })

    The response would look like this:

      [
        {
          'item-id: '50bf2e6e-9776-441e-8215-08966581fcec',
          record: {
            todo: 'remember the milk',
            completed: true
          }
        },
        undefined, // the deleted orange juice
        {
          'item-id': 'b09cf9c2-86bd-499c-af06-709d5c11f64b',
          record: {
            todo: 'create the most useful app of all time'
          }
        }
      ]

  */
const sync = async () => {
  const startingSeqNo = stateManager.getMaxSequenceNo() + 1

  // retrieving user's transaction log
  let t0 = performance.now()
  const { transactionLog, bundleSeqNo } = await wrapInAuthenticationErrorCatcher(
    server.db.queryTransactionLog(startingSeqNo)
  )
  console.log(`Retrieved user's transaction log in ${getSecondsSinceT0(t0)}s`)

  let encryptedDbState
  // if server sets bundle-seq-no header, that means the transaction log starts
  // with transactions with sequence number > bundle-seq-no. Thus the transactions
  // in the log need to be applied to the db state bundled at bundle-seq-no
  if (bundleSeqNo) {
    // retrieving user's encrypted db state
    t0 = performance.now()
    encryptedDbState = await wrapInAuthenticationErrorCatcher(
      server.db.queryEncryptedDbState(bundleSeqNo)
    )
    console.log(`Retrieved user's encrypted db state in ${getSecondsSinceT0(t0)}s`)
  }

  // starting to set up client state
  t0 = performance.now()
  await setupClientState(transactionLog, encryptedDbState)
  console.log(`Set up client side state in ${getSecondsSinceT0(t0)}s`)
}

/**

    Gets the items in order of insertion from memory. Make sure to call
    sync() before calling this function to get the latest state.

 */
const getItems = () => {
  const itemsInOrderOfInsertion = stateManager.getItems()

  setIteratorsToSkipDeletedItems(itemsInOrderOfInsertion)

  return itemsInOrderOfInsertion
}

export default {
  insert,
  batchInsert,
  update,
  batchUpdate,
  'delete': deleteFunction,
  batchDelete,
  sync,
  getItems
}
