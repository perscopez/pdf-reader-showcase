declare module 'archiver' {
  import { Transform } from 'stream'

  interface ZipArchiveOptions {
    zlib?: { level?: number }
  }

  interface ArchiveEntryOptions {
    name: string
  }

  export class ZipArchive extends Transform {
    constructor(options?: ZipArchiveOptions)
    append(source: string | Buffer | NodeJS.ReadableStream, options: ArchiveEntryOptions): this
    finalize(): Promise<void>
  }
}
