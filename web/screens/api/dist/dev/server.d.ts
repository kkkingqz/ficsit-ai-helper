import { type DevSource } from "./source.js";
export interface DevServerOptions {
    /** Каталог со страницами. */
    root: string;
    source: DevSource;
    port?: number;
    host?: string;
    /** Следить ли за файлами и перезагружать вкладку. */
    watch?: boolean;
    log?: (message: string) => void;
}
export interface DevServer {
    readonly port: number;
    readonly url: string;
    close(): Promise<void>;
}
export declare function startDevServer(options: DevServerOptions): Promise<DevServer>;
