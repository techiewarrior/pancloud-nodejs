"use strict";
// Copyright 2015-2019 Palo Alto Networks, Inc
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//       http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
Object.defineProperty(exports, "__esModule", { value: true });
const https_1 = require("https");
const url_1 = require("url");
const statusTextDict = {
    200: '200 OK',
    300: '301 Moved Permanently',
    302: '302 Found',
    303: '303 See Other',
    304: '304 Not Modified',
    400: '400 Bad Request',
    401: '401 Unauthorized',
    500: '500 Internal Server Error',
    501: '501 Not Implemented',
    502: '502 Bad Gateway',
    503: '503 Service Unavailable',
    504: '504 Gateway Timeout'
};
class FetchResponse {
    constructor(ok, data = '', status = 200) {
        this.ok = ok;
        this.data = data;
        this.status = status;
        this.statusText = (statusTextDict[status]) ? statusTextDict[status] : String(status);
        this.size = data.length;
    }
    text() {
        return this.data;
    }
    json() {
        return JSON.parse(this.data);
    }
    static response(ok, data, status) {
        return new FetchResponse(ok, data, status);
    }
}
function fetch(url, ops) {
    let newUrl = new url_1.URL(url);
    let rOps = {
        protocol: newUrl.protocol,
        hostname: newUrl.hostname,
        path: newUrl.pathname,
        method: ops.method,
        headers: ops.headers,
        timeout: ops.timeout
    };
    return new Promise((resolve, reject) => {
        let cRequest = https_1.request(rOps, resp => {
            let data = '';
            resp.on('data', chunk => {
                data += chunk;
            });
            resp.on('end', () => {
                resolve(FetchResponse.response(!(resp.statusCode && (resp.statusCode < 200 || resp.statusCode > 299)), data, resp.statusCode));
            });
        }).on("error", err => {
            reject(Error(err.message));
        });
        cRequest.end(ops.body);
    });
}
exports.fetch = fetch;
