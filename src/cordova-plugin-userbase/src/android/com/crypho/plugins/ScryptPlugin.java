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

package com.crypho.plugins;

import android.util.Log;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaArgs;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONException;

public class ScryptPlugin extends CordovaPlugin {
	private static final String TAG = "Scrypt";
	private static final char[] HEX = {'0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F'};

	static {
    	System.loadLibrary("scrypt_crypho");
    }

	public native byte[] scrypt(byte[] pass, byte[] salt, Integer N, Integer r, Integer p, Integer dkLen);

	@Override
	public boolean execute(String action, CordovaArgs args, final CallbackContext callbackContext) throws JSONException {
		if ("scrypt".equals(action)) {
			final Object arg_passphrase = args.get(0);
			final Object arg_salt = args.get(1);

			JSONObject options = args.getJSONObject(2);
			final Integer N = getIntegerOption("N", options);
			final Integer r = getIntegerOption("r", options);
			final Integer p = getIntegerOption("p", options);
			final Integer dkLen = getIntegerOption("dkLen", options);

			cordova.getThreadPool().execute(new Runnable() {
				public void run() {
					try {
						byte[] passwordBytes = getBytes(arg_passphrase);
						byte[] saltBytes = getBytes(arg_salt);
						byte[] res = scrypt(passwordBytes, saltBytes, N, r, p, dkLen);
						String result = hexify(res);
						callbackContext.success(result);
					} catch (Exception e) {
						Log.e(TAG, "Scrypt Failed: " + e.getMessage());
						callbackContext.error(e.getMessage());
					}
				}
			});
			return true;
		}
		return false;
	}

	private String hexify (byte[] input) {
		int len = input.length;
		char[] result = new char[2 * len];
		for ( int j = 0; j < len; j++ ) {
        	int v = input[j] & 0xFF;
        	result[j * 2] = HEX[v >>> 4];
        	result[j * 2 + 1] = HEX[v & 0x0F];
    	}
    	return new String(result).toLowerCase();
	}

	private Integer getIntegerOption(String option, JSONObject options) {
		int arg = options.optInt(option);
		return arg != 0 ? Integer.valueOf(arg) : null;
	}

	private byte[] getBytes(Object src) throws Exception {
		if (src instanceof JSONArray) {
			JSONArray tmp = (JSONArray) src;
			int len = tmp.length();
			byte[] result = new byte[len];
			for (int i = 0; i < len ; i++) {
				result[i] = (byte) tmp.optInt(i);
			}
			return result;
		} else {
			return ((String) src).getBytes("UTF-8");
		}
	}
}