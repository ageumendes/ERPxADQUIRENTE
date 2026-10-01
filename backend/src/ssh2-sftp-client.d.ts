declare module 'ssh2-sftp-client' {
  export type FileInfo = { name: string; type: string; size: number; modifyTime?: number; accessTime?: number; rights?: unknown; owner?: number; group?: number };
  export default class SftpClient {
    constructor(name?: string);
    connect(config: Record<string, unknown>): Promise<void>;
    list(remotePath: string): Promise<FileInfo[]>;
    realPath(remotePath: string): Promise<string>;
    lstat(remotePath: string): Promise<{ isFile: boolean; isSymbolicLink: boolean }>;
    fastGet(remotePath: string, localPath: string): Promise<void>;
    fastPut(localPath: string, remotePath: string): Promise<void>;
    delete(remotePath: string): Promise<void>;
    mkdir(remotePath: string, recursive?: boolean): Promise<void>;
    exists(remotePath: string): Promise<boolean | string>;
    rename(fromPath: string, toPath: string): Promise<void>;
    end(): Promise<void>;
  }
}
