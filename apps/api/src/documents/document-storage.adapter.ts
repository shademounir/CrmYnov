import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

export interface StoredSyntheticDocument { storageReference: string; sanitizedFileName: string; extension: string; declaredMime: string; detectedMime: string; byteSize: number; sha256: string }
export interface DocumentStorageAdapter { store(input: { originalName: string; declaredMime: string; content: Uint8Array }): Promise<StoredSyntheticDocument>; cleanup(): Promise<void> }

const formats = new Map([
  [".pdf", { mime: "application/pdf", signature: (value: Uint8Array): boolean => Buffer.from(value.subarray(0, 5)).toString("ascii") === "%PDF-" }],
  [".png", { mime: "image/png", signature: (value: Uint8Array): boolean => Buffer.from(value.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  [".jpg", { mime: "image/jpeg", signature: (value: Uint8Array): boolean => value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff }],
  [".jpeg", { mime: "image/jpeg", signature: (value: Uint8Array): boolean => value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff }],
]);

@Injectable()
export class LocalTemporaryDocumentStorageAdapter implements DocumentStorageAdapter {
  private directory: string | undefined;
  constructor(private readonly syntheticScannerAvailable = true, private readonly maxBytes = 5 * 1024 * 1024) {}

  async store(input: { originalName: string; declaredMime: string; content: Uint8Array }): Promise<StoredSyntheticDocument> {
    if (!this.syntheticScannerAvailable) throw new ServiceUnavailableException({ code: "document_antivirus_unavailable" });
    if (input.originalName !== basename(input.originalName) || input.originalName.includes("\0") || input.originalName.includes("..")) throw new BadRequestException({ code: "document_path_invalid" });
    if (input.content.byteLength === 0 || input.content.byteLength > this.maxBytes) throw new BadRequestException({ code: "document_size_invalid" });
    const extension = extname(input.originalName).toLowerCase(); const format = formats.get(extension);
    if (format?.mime !== input.declaredMime.toLowerCase() || !format.signature(input.content)) throw new BadRequestException({ code: "document_format_invalid" });
    if (Buffer.from(input.content).subarray(0, 2048).toString("latin1").includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) throw new BadRequestException({ code: "document_malware_suspected" });
    this.directory ??= await mkdtemp(join(tmpdir(), "crmynov-documents-"));
    const id = randomUUID(); const sanitizedFileName = `document-${id}${extension}`; const target = join(this.directory, sanitizedFileName);
    if (!target.startsWith(`${this.directory}\\`) && !target.startsWith(`${this.directory}/`)) throw new BadRequestException({ code: "document_path_invalid" });
    await writeFile(target, input.content, { flag: "wx" });
    return { storageReference: `temporary://${id}`, sanitizedFileName, extension, declaredMime: input.declaredMime.toLowerCase(), detectedMime: format.mime, byteSize: input.content.byteLength, sha256: createHash("sha256").update(input.content).digest("hex") };
  }

  async cleanup(): Promise<void> {
    if (this.directory) {
      await rm(this.directory, { recursive: true, force: true });
    }
    this.directory = undefined;
  }
}
