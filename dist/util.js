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
/**
 * Utility collection
 */
const buffer_1 = require("buffer");
const common_1 = require("./common");
const error_1 = require("./error");
function isDecoDnsItem(item) {
    return item.seqno && item.value && typeof (item.seqno) == "number" && typeof (item.value) == "string";
}
/**
 * Class containing a static public method with utilities
 */
class Util {
    static dnsResolve(label, offsets = {}) {
        if (!label.length) {
            return "";
        }
        let domain = [];
        let dnsNameLen = 0;
        let pointer = 0;
        let code = label[0];
        let maxIterations = 250;
        while (code) {
            if (maxIterations-- == 0) {
                throw new Error("Too many iterations (loop?)");
            }
            if (code > 63) {
                code = (code & 0x3f) << 8 | label[pointer + 1];
                pointer = 0;
                if (code in offsets) {
                    label = offsets[code];
                }
                else if (!(Object.entries(offsets).some(([bCode, bBuf]) => {
                    let num_bCode = parseInt(bCode, 10);
                    if (num_bCode < code && code < num_bCode + bBuf.length) {
                        label = bBuf.slice(code - num_bCode);
                        return true;
                    }
                    return false;
                }))) {
                    throw new Error("Pointer not found");
                }
            }
            else {
                pointer++;
                let token = String.fromCharCode(...label.slice(pointer, pointer + code));
                dnsNameLen += token.length;
                if (dnsNameLen > 250) {
                    throw new Error("Name too large (loop?)");
                }
                domain.push(token);
                pointer += code;
            }
            code = label[pointer];
        }
        return domain.join('.');
    }
    static dnsProcessElement(element, offsets, name_property, type_property) {
        element.forEach(item => {
            if (!(type_property in item)) {
                return;
            }
            let itemType = item[type_property];
            Object.keys(item).forEach(key => {
                if (key == type_property) {
                    item[key] = Util.typeAlias[item[key]];
                    return;
                }
                let dDnsItem = item[key];
                if (isDecoDnsItem(dDnsItem)) {
                    let label = Uint8Array.from(buffer_1.Buffer.from(dDnsItem.value, 'base64'));
                    offsets[dDnsItem.seqno] = label;
                    if (key == name_property) {
                        try {
                            item[key].value = Util.dnsResolve(label, offsets);
                        }
                        catch (_a) {
                            throw new Error(`Unable to decode ${JSON.stringify(item)}`);
                        }
                        return;
                    }
                    if (itemType == 16) { // TXT decoding
                        dDnsItem.value = label.toString();
                        return;
                    }
                    if (itemType == 1) { // IPv4 decoding
                        dDnsItem.value = label.join('.');
                        return;
                    }
                    if (itemType == 28) { // IPv6 decoding
                        let ipv6Parts = [];
                        new Uint16Array(label.buffer).forEach(x => ipv6Parts.push(('000' + x.toString(16)).slice(-4)));
                        dDnsItem.value = ipv6Parts.join(':');
                        return;
                    }
                    if ([60, 48, 45, 46, 25, 61, 43, 41].includes(itemType)) {
                        let hexParts = [];
                        label.forEach(x => hexParts.push(('0' + x.toString(16)).slice(-2)));
                        dDnsItem.value = hexParts.join(':');
                        return;
                    }
                    try {
                        dDnsItem.value = Util.dnsResolve(label, offsets);
                    }
                    catch (_b) {
                        throw new Error(`Unable to decode ${JSON.stringify(item)}`);
                    }
                }
            });
        });
    }
    /**
     * Transforms the object provided decoding all DNS fields found in it
     * @param event Any Application Framework event object. Only the ones with type == 'DPI' and
     * subtype == 'dns' will be processed
     */
    static dnsDecode(event) {
        if (!(event.type && event.subtype && event.type == 'DPI' && event.subtype == 'dns')) {
            return false;
        }
        let decoded = true;
        try {
            if (event['dns-req-query-items']) {
                Util.dnsProcessElement(event['dns-req-query-items'], {}, 'dns-req-query-name', 'dns-req-query-type');
            }
            let offsets = {};
            if (event['dns-rsp-query-items']) {
                Util.dnsProcessElement(event['dns-rsp-query-items'], offsets, 'dns-rsp-query-name', 'dns-rsp-query-type');
            }
            if (event['dns-rsp-resource-record-items']) {
                Util.dnsProcessElement(event['dns-rsp-resource-record-items'], offsets, 'dns-rsp-rr-name', 'dns-rsp-rr-type');
            }
        }
        catch (e) {
            common_1.commonLogger.error(error_1.PanCloudError.fromError({ className: "utilityclass" }, e));
            decoded = false;
        }
        return decoded;
    }
    /**
    * Converts a the pcap base64 string found on some Application Framework events into
    * a pcap file payload
    * @param event The Application Framework event object containing the pcap property
    * @return a Buffer containing a valid pcap file payload or null if the provided
    * event does not have a valid pcap property
    */
    static pcaptize(event) {
        if (!(event.pcap)) {
            return null;
        }
        let pcapData = buffer_1.Buffer.from(event.pcap, 'base64');
        let captureSize = pcapData.readUInt32BE(4);
        let packetSize = pcapData.readUInt16BE(30);
        let timeStamp = pcapData.readUInt32BE(16);
        let pcapBody;
        let bodySize = (captureSize > packetSize) ? packetSize : captureSize;
        pcapBody = buffer_1.Buffer.alloc(40 + bodySize);
        pcapBody.writeUInt32BE(0xd4c3b2a1, 0); // Header Magic Number
        pcapBody.writeUInt32BE(0x00020004, 4); // Header Major and Minor version
        pcapBody.writeUInt32BE(0x00000000, 8); // Header Time Zone
        pcapBody.writeUInt32BE(0x00000000, 12); // Header Accuracy
        pcapBody.writeUInt32BE(0xffffffff, 16); // Header Snaplen
        pcapBody.writeUInt32BE(0x01000000, 20); // Header Datalink
        pcapBody.writeUInt32LE(timeStamp, 24); // Packet Timestamp
        pcapBody.writeUInt32BE(0x00000000, 28); // Packet uSeconds
        pcapBody.writeUInt32LE(bodySize, 32); // Included Size
        pcapBody.writeUInt32LE(packetSize, 36); // Original Packet Size
        pcapData.copy(pcapBody, 40, 36, 36 + bodySize);
        return pcapBody;
    }
}
Util.typeAlias = {
    1: "A",
    28: "AAAA",
    18: "AFSDB",
    42: "APL",
    257: "CAA",
    60: "CDNSKEY",
    59: "CDS",
    37: "CERT",
    5: "CNAME",
    49: "DHCID",
    32769: "DLV",
    39: "DNAME",
    48: "DNSKEY",
    43: "DS",
    55: "HIP",
    45: "IPSECKEY",
    25: "KEY",
    36: "KX",
    29: "LOC",
    15: "MX",
    35: "NAPTR",
    2: "NS",
    47: "NSEC",
    3: "NSEC",
    61: "OPENPGPKEY",
    12: "PTR",
    46: "RRSIG",
    17: "RP",
    24: "SIG",
    53: "SMIMEA",
    6: "SOA",
    33: "SRV",
    44: "SSHFP",
    32768: "TA",
    249: "TKEY",
    52: "TLSA",
    250: "TSIG",
    16: "TXT",
    256: "URI",
    255: "ANY",
    252: "AXFR",
    251: "AXFR",
    41: "OPT"
};
exports.Util = Util;
