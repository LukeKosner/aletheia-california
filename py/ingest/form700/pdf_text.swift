import Foundation
import PDFKit

// PDFKit is supplied by macOS; no package installation is required.
guard CommandLine.arguments.count == 2,
      let pdf = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else {
    fputs("Unable to open PDF\n", stderr)
    exit(1)
}
var pages: [String] = []
for index in 0..<pdf.pageCount {
    pages.append(pdf.page(at: index)?.string ?? "")
}
let data = try JSONSerialization.data(withJSONObject: pages, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
