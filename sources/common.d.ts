/*
 * Copyright 2015 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

declare module common {

  interface AppSettings {

    /**
     * Whether or not to write log statements to stderr
     */
    consoleLogging: boolean;

    /**
     * The minimum threshold for log statements to be written to stderr.
     * Values should be one of 'trace', 'debug', 'info',
     * 'warn', 'error', or 'fatal'.
     */
    consoleLogLevel: string;

    logFilePath: string;
    logFilePeriod: string;
    logFileCount: number;

    /**
     * The port that the server should listen to.
     */
    serverPort: number;

    /**
     * The list of static arguments to be used when launching jupyter.
     */
    jupyterArgs: string[];

    /**
     * If provided, use this as a prefix to all file paths opened on the
     * server side. Useful for testing outside a Docker container.
     */
    datalabRoot: string;

    /**
     * If provided, use this as a prefix to all URL paths. This is useful
     * for running a Datalab instance behind a shared proxy with other
     * servers (including, for running multiple Datalab instances together).
     *
     * The specified value does not need to include leading or trailing
     * slashes. Those will automatically be added if ommitted.
     */
    datalabBasePath: string;

    /**
     * Initial port to use when searching for a free Jupyter port.
     */
    nextJupyterPort: number;

    /**
     * The port to use for socketio proxying.
     */
    socketioPort: number;

    /**
     * Local directory which stores notebooks in the container
     */
    contentDir: string;

    /**
     * The value for the access-control-allow-origin header. This
     * allows another frontend to connect to Datalab.
     */
    allowOriginOverrides: Array<string>;

    /**
     * If true, allow HTTP requests via websockets.
     */
    allowHttpOverWebsocket: boolean;

    /**
     * The port to use to proxy kernel manager websocket requests. A value of 0
     * disables proxying.
     */
    kernelManagerProxyPort: number;
  }

  interface Map<T> {
    [index: string]: T;
  }

  interface Callback<T> {
    (e: Error, result: T): void;
  }

  interface Callback0 {
    (e: Error): void;
  }
}
