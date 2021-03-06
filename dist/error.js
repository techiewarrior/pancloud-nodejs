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
function isError(obj) {
    return typeof obj.errorCode == 'string' && typeof obj.errorMessage == 'string';
}
class SdkErr extends Error {
    constructor(message) {
        super(message);
    }
    getErrorCode() {
        return this.errorCode;
    }
    getErrorMessage() {
        return this.errorMessage;
    }
    getSourceClass() {
        return this.sourceClass;
    }
    setClassName(name) {
        this.name = name;
    }
}
exports.SdkErr = SdkErr;
function isSdkError(e) {
    return e &&
        e.getErrorCode && typeof e.getErrorCode == "function" &&
        e.getErrorMessage && typeof e.getErrorMessage == "function" &&
        e.getSourceClass && typeof e.getSourceClass == "function" &&
        e.name && typeof e.name == "string" &&
        (e.name == "PanCloudError" || e.name == "ApplicationFrameworkError");
}
exports.isSdkError = isSdkError;
class ApplicationFrameworkError extends SdkErr {
    constructor(source, afError) {
        if (isError(afError)) {
            super(afError.errorMessage);
            this.errorMessage = afError.errorMessage;
            this.errorCode = afError.errorCode;
        }
        else {
            super("Unparseable Application Framework error message");
            this.errorMessage = JSON.stringify(afError);
            this.errorCode = '';
        }
        this.sourceClass = source.className;
        this.setClassName("ApplicationFrameworkError");
    }
}
exports.ApplicationFrameworkError = ApplicationFrameworkError;
class PanCloudError extends SdkErr {
    constructor(source, code, message) {
        super(message);
        this.errorCode = code;
        this.errorMessage = message;
        this.sourceClass = source.className;
        this.setClassName("PanCloudError");
    }
    static fromError(sorce, e) {
        let newpce = new PanCloudError(sorce, "UNKNOWN", e.message);
        newpce.stack = e.stack;
        return newpce;
    }
}
exports.PanCloudError = PanCloudError;
