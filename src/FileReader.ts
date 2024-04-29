import path from "node:path"
import fs from "node:fs/promises"

export class FileSystem {

  public cwd: string

  constructor(public rootPath: string) {
    this.cwd = ""
  }

  async read(relativePath: string, numberOfLines = 100): Promise<FileReader> {
    const fileReader = new FileReader(path.join(this.rootPath, this.cwd, relativePath), numberOfLines)
    await fileReader.readAll()
    return fileReader
  }

  async list() {
    const dirPath = path.join(this.rootPath, this.cwd);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map(entry => {
      return `${entry.name} ${entry.isDirectory() ? "<DIR>" : "<FILE>"}: `;
    });
  }

  async changeDirectory(relativePath: string) {
    this.cwd = path.resolve(this.rootPath, path.join(this.cwd, relativePath))
    return this.list()
  }
}

export class FileReader {
  public allContent: string = ""
  private contentLines: number = 0
  private cursor = 0

  constructor(public absoluteUrl: string, public numberOfLines: number) { }

  async readAll() {
    this.allContent = await Bun.file(this.absoluteUrl).text()
    this.contentLines = this.allContent.split("\n").length
    return this.allContent
  }

  readPage() {
    const lines = this.allContent.split("\n")
    const maxDigits = lines.length.toString().length;
    return lines.map((line, index) => {
      const indexStr = (index + this.cursor).toString().padEnd(maxDigits);
      return `${indexStr} : ${line}`;
    })
  }

  pageDown() {
    this.cursor += this.numberOfLines
    if (this.cursor > (this.contentLines - this.numberOfLines)) {
      this.cursor = this.contentLines - this.numberOfLines
    }
    return this.readPage().join("\n")
  }

  pageUp() {
    this.cursor -= this.numberOfLines
    if (this.cursor < 0) {
      this.cursor = 0
    }
    return this.readPage().join('\n')
  }
}