/*

	Copyright (c) 2015 Crypho AS.

	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included in
	all copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
	THE SOFTWARE.

	libscrypt is Copyright (c) 2013, Joshua Small under the BSD license. See src/libscrypt/LICENSE

*/

#import <Foundation/Foundation.h>
#import "ScryptPlugin.h"
#import "libscrypt.h"
#import <Cordova/CDV.h>

@implementation ScryptPlugin

@synthesize callbackId;

- (void)scrypt:(CDVInvokedUrlCommand*)command
{
    int i, success;

    const uint8_t *parsedSalt;
    const uint8_t *parsedPassphrase;

    size_t passphraseLength;
    size_t saltLength;

    id passphrase = [command argumentAtIndex:0];
    id salt = [command argumentAtIndex:1];

    uint8_t *passphraseBuffer = NULL;
    uint8_t *saltBuffer = NULL;

    if ([passphrase isKindOfClass:[NSString class]]) {
        parsedPassphrase = (uint8_t *)(const char*)[passphrase UTF8String];
        passphraseLength = strlen(parsedPassphrase);
    } else if ([passphrase isKindOfClass:[NSArray class]]) {
        passphraseLength = (int) [passphrase count];
        passphraseBuffer = malloc(sizeof(uint8_t) * passphraseLength);

        for (i = 0; i < passphraseLength; ++i) {
            passphraseBuffer[i] = (uint8_t)[[passphrase objectAtIndex:i] integerValue];
        }
        parsedPassphrase = passphraseBuffer;
    }

    if ([salt isKindOfClass:[NSString class]]) {
        parsedSalt = (uint8_t *)(const char*)[salt UTF8String];
        saltLength = strlen(parsedSalt);
    } else if ([salt isKindOfClass:[NSArray class]]) {
        saltLength = (int) [salt count];
        saltBuffer = malloc(sizeof(uint8_t) * saltLength);

        for (i = 0; i < saltLength; ++i) {
            saltBuffer[i] = (uint8_t)[[salt objectAtIndex:i] integerValue];
        }
        parsedSalt = saltBuffer;
    }

    // Parse options
    NSMutableDictionary* options = [command.arguments objectAtIndex:2];
    uint64_t N = [options[@"N"] unsignedLongValue] ?: SCRYPT_N;
    uint32_t r = [options[@"r"] unsignedShortValue] ?: SCRYPT_r;
    uint32_t p = [options[@"p"] unsignedShortValue] ?: SCRYPT_p;
    uint32_t dkLen = [options[@"dkLen"] unsignedShortValue] ?: 32;

    uint8_t hashbuf[dkLen];
    self.callbackId = command.callbackId;

    @try {
        success = libscrypt_scrypt(parsedPassphrase, passphraseLength, parsedSalt, saltLength, N, r, p, hashbuf, dkLen);
    }
    @catch (NSException * e) {
        [self failWithMessage: [NSString stringWithFormat:@"%@", e] withError: nil];
    }

    if (success!=0) {
        [self failWithMessage: @"Failure in scrypt" withError: nil];
    }


    // Hexify
    NSMutableString *hexResult = [NSMutableString stringWithCapacity:dkLen * 2];
    for(i = 0;i < dkLen; i++ )
    {
        [hexResult appendFormat:@"%02x", hashbuf[i]];
    }
    NSString *result = [NSString stringWithString: hexResult];
    [self successWithMessage: result];

    free(passphraseBuffer);
    free(saltBuffer);
}

-(void)successWithMessage:(NSString *)message
{
    if (self.callbackId != nil)
    {
        CDVPluginResult *commandResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsString:message];
        [self.commandDelegate sendPluginResult:commandResult callbackId:self.callbackId];
    }
}

-(void)failWithMessage:(NSString *)message withError:(NSError *)error
{
    NSString        *errorMessage = (error) ? [NSString stringWithFormat:@"%@ - %@", message, [error localizedDescription]] : message;
    CDVPluginResult *commandResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:errorMessage];

    [self.commandDelegate sendPluginResult:commandResult callbackId:self.callbackId];
}

@end
