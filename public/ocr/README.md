# On-device receipt OCR

Tesseract.js 6.0.1, Tesseract.js-core 6.0.0 and the English 4.0.0_best_int trained data from @tesseract.js-data/eng 1.0.0 are self-hosted here. Source: https://github.com/naptha/tesseract.js and its published packages. See the included license notices. The trained data is from https://github.com/tesseract-ocr/tessdata_fast (Apache 2.0).

The browser loads these assets from this Site and runs recognition in a Worker. Receipt photos are not sent to an external OCR service. The existing private receipt upload still saves the readable source to this Site. When the owner configures a vision model, the existing server extraction path may use that configured model.

OCR output is untrusted source evidence. The server parses it into a durable draft; unknown values remain unknown. Human review, item assignment, exact totals, payer confirmation and affected-member approvals are still required before recording shared expenses.
