/*
* Node WebUSB
* Copyright (c) 2017 Rob Moran
*
* The MIT License (MIT)
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in all
* copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
* SOFTWARE.
*/

import { EventDispatcher, TypedDispatcher } from "./dispatcher";
import { USBDevice } from "./device";
import { USBOptions, USBDeviceRequestOptions } from "./interfaces";
import { USBAdapter, adapter } from "./adapter";

/**
 * Events raised by the USB class
 */
export interface USBEvents {
    /**
     * @hidden
     */
    newListener: keyof USBEvents;
    /**
     * @hidden
     */
    removeListener: keyof USBEvents;
    /**
     * USBDevice connected event
     */
    connect: USBDevice;
    /**
     * USBDevice disconnected event
     */
    disconnect: USBDevice;
}

/**
 * USB class
 */
export class USB extends (EventDispatcher as new() => TypedDispatcher<USBEvents>) {

    private allowedDevices: Array<USBDevice> = [];
    private devicesFound: (devices: Array<USBDevice>) => Promise<USBDevice | void>;

    /**
     * USB constructor
     * @param options USB initialisation options
     */
    constructor(options?: USBOptions) {
        super();

        options = options || {};
        this.devicesFound = options.devicesFound;

        const deviceConnectCallback = device => {
            // When connected, emit an event if it was a known allowed device
            if (this.replaceAllowedDevice(device)) {
                this.emit("connect", device);
            }
        };

        const deviceDisconnectCallback = handle => {
            // When disconnected, emit an event if the device was a known allowed device
            const allowedDevice = this.allowedDevices.find(allowedDevices => allowedDevices._handle === handle);

            if (allowedDevice) {
                this.emit("disconnect", allowedDevice);
            }
        };

        this.on("newListener", event => {
            const listenerCount = this.listenerCount(event);

            if (listenerCount !== 0) {
                return;
            }

            if (event === "connect") {
                adapter.addListener(USBAdapter.EVENT_DEVICE_CONNECT, deviceConnectCallback);
            } else if (event === "disconnect") {
                adapter.addListener(USBAdapter.EVENT_DEVICE_DISCONNECT, deviceDisconnectCallback);
            }
        });

        this.on("removeListener", event => {
            const listenerCount = this.listenerCount(event);

            if (listenerCount !== 0) {
                return;
            }

            if (event === "connect") {
                adapter.removeListener(USBAdapter.EVENT_DEVICE_CONNECT, deviceConnectCallback);
            } else if (event === "disconnect") {
                adapter.removeListener(USBAdapter.EVENT_DEVICE_DISCONNECT, deviceDisconnectCallback);
            }
        });
    }

    private replaceAllowedDevice(device: USBDevice): boolean {
        for (const i in this.allowedDevices) {
            if (this.isSameDevice(device, this.allowedDevices[i])) {
                this.allowedDevices[i] = device;
                return true;
            }
        }

        return false;
    }

    private isSameDevice(device1: USBDevice, device2: USBDevice): boolean {
        return (device1.productId === device2.productId
             && device1.vendorId === device2.vendorId
             && device1.serialNumber === device2.serialNumber);
    }

    private filterDevice(options: USBDeviceRequestOptions, device: USBDevice): boolean {
        return options.filters.some(filter => {
            // Vendor
            if (filter.vendorId && filter.vendorId !== device.vendorId) return false;

            // Product
            if (filter.productId && filter.productId !== device.productId) return false;

            // Class
            if (filter.classCode) {

                // Interface Descriptors
                const match = device.configuration.interfaces.some(iface => {
                    // Class
                    if (filter.classCode && filter.classCode !== iface.alternate.interfaceClass) return false;

                    // Subclass
                    if (filter.subclassCode && filter.subclassCode !== iface.alternate.interfaceSubclass) return false;

                    // Protocol
                    if (filter.protocolCode && filter.protocolCode !== iface.alternate.interfaceProtocol) return false;

                    return true;
                });

                if (match) return true;
            }

            // Class
            if (filter.classCode && filter.classCode !== device.deviceClass) return false;

            // Subclass
            if (filter.subclassCode && filter.subclassCode !== device.deviceSubclass) return false;

            // Protocol
            if (filter.protocolCode && filter.protocolCode !== device.deviceProtocol) return false;

            // Serial
            if (filter.serialnumber && filter.serialnumber !== device.serialNumber) return false;

            return true;
        });
    }

    /**
     * Gets all allowed Web USB devices which are connected
     * @returns Promise containing an array of devices
     */
    public getDevices(): Promise<Array<USBDevice>> {
        // Refresh devices and filter for allowed ones
        return adapter.listUSBDevices()
        .then(devices => {
            const allowed = devices.filter(device => {
                if (!device.connected) {
                    return false;
                }

                for (const i in this.allowedDevices) {
                    if (this.isSameDevice(device, this.allowedDevices[i])) {
                        return true;
                    }
                }

                return false;
            });

            return allowed;
        });
    }

    /**
     * Requests a single Web USB device
     * @param options The options to use when scanning
     * @returns Promise containing the selected device
     */
    public requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice> {
        return new Promise((resolve, reject) => {
            // Must have options
            if (!options) {
                return reject(new TypeError("requestDevice error: 1 argument required, but only 0 present"));
            }

            // Options must be an object
            if (options.constructor !== {}.constructor) {
                return reject(new TypeError("requestDevice error: parameter 1 (options) is not an object"));
            }

            // Must have a filter
            if (!options.filters) {
                return reject(new TypeError("requestDevice error: required member filters is undefined"));
            }

            // Filter must be an array
            if (options.filters.constructor !== [].constructor) {
                return reject(new TypeError("requestDevice error: the provided value cannot be converted to a sequence"));
            }

            // Check filters
            const check = options.filters.every(filter => {

                // Protocol & Subclass
                if (filter.protocolCode && !filter.subclassCode) {
                    reject(new TypeError("requestDevice error: subclass code is required"));
                    return false;
                }

                // Subclass & Class
                if (filter.subclassCode && !filter.classCode) {
                    reject(new TypeError("requestDevice error: class code is required"));
                    return false;
                }

                return true;
            });

            if (!check) return;

            return adapter.listUSBDevices()
            .then(devices => {
                devices = devices.filter(device => this.filterDevice(options, device));

                if (devices.length === 0) {
                    return reject(new Error("requestDevice error: no devices found"));
                }

                function selectFn(device: USBDevice) {
                    if (!this.replaceAllowedDevice(device)) this.allowedDevices.push(device);
                    resolve(device);
                }

                // If no devicesFound function, select the first device found
                if (!this.devicesFound) return selectFn.call(this, devices[0]);

                return this.devicesFound(devices)
                .then(device => {
                    if (!device) {
                        reject(new Error("selected device not found"));
                    }

                    return selectFn.call(this, device);
                });
            }).catch(error => {
                reject(new Error(`requestDevice error: ${error}`));
            });
        });
    }
}
