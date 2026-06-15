declare module 'ssh2-sftp-client' {
  export type FileInfo = { name: string; type: string; size: number; modifyTime?: number; accessTime?: number; rights?: unknown; owner?: number; group?: number };
  export default class SftpClient {
    constructor(name?: string);
    connect(config: Record<string, unknown>): Promise<void>;
    list(remotePath: string): Promise<FileInfo[]>;
    fastGet(remotePath: string, localPath: string): Promise<void>;
    mkdir(remotePath: string, recursive?: boolean): Promise<void>;
    rename(fromPath: string, toPath: string): Promise<void>;
    end(): Promise<void>;
  }
}
