# PDF Studio vs Adobe Acrobat: capability comparison

_Researched 3 November 2026 from Adobe’s own product pages (see [Sources](#sources)). PDF Studio runs 100% in the browser: no uploads, no accounts, works offline. Some Acrobat features need a server or a proprietary engine, so they cannot be offered without breaking that promise. Those are marked as not feasible locally, with the reason._

## Summary

57 Acrobat capabilities compared:

| Status | Count | Meaning |
| --- | --- | --- |
| ✅ Have | 27 | Works end to end and is covered by automated tests |
| 🟡 Partial | 13 | Works, with stated limits |
| ⬜ Missing | 7 | Possible locally but not built yet |
| ⛔ Not feasible locally | 10 | Needs a server, cloud AI, certificates or a proprietary engine |

**Main gaps:** e-signature workflows (request, track, bulk send), certificate digital signatures, AI Assistant, PDF/A, PDF/X and preflight, accessibility tagging, Office round-trips beyond Word (PDF to Excel or PowerPoint, PowerPoint to PDF), and true in-place text reflow.

## Feature by feature

### View & navigate

| Acrobat capability | Acrobat plan | PDF Studio | Notes | Source |
| --- | --- | --- | --- | --- |
| Open and read PDFs: continuous scroll, zoom, fit width/page, thumbnails | Reader | ✅ Have | **View & search** tool; pages render lazily so large files stay fast. | [plans][plans] |
| Find text in the document | Reader | ✅ Have | Full-text search with highlighted matches and next/previous; text is selectable and copyable. | [plans][plans] |
| Navigate by bookmarks | Reader | ✅ Have | Bookmarks panel in **View & search**. | [plans][plans] |
| Read Aloud / Liquid Mode | Reader | ⬜ Missing | Not built. Read Aloud could use the browser speech API later; Liquid Mode is an Adobe cloud AI feature. | [plans][plans] |

### Edit

| Acrobat capability | Acrobat plan | PDF Studio | Notes | Source |
| --- | --- | --- | --- | --- |
| Edit existing text | Standard | 🟡 Partial | **Edit PDF** lets you click a line and retype it. The new text is drawn over a white box in the closest standard font (bold and italic are detected). The original glyphs stay underneath, and a line cannot reflow into the next one. | [pro][pro] |
| Add new text boxes | Standard | ✅ Have | **Edit PDF → Add text**, and **Sign & annotate**. | [pro][pro] |
| Add or replace images | Standard | 🟡 Partial | You can add images (Edit PDF, Sign & annotate). Images already in the PDF cannot be moved or replaced. | [pro][pro] |
| White-out / cover content | Standard | ✅ Have | **Edit PDF → White-out**. Use **Redact** when the content must really be removed. | [pro][pro] |
| Watermark | Standard | ✅ Have | Text or image watermark, with opacity, rotation and a page range. | [online][online] |
| Header & footer | Standard | ✅ Have | **Header & footer**: 6 slots with {page}, {pages}, {date} and {file} tokens. | [pro][pro] |
| Bates numbering | Pro | ✅ Have | **Header & footer** supports `{bates}` with a prefix, suffix, start number and digit count. | [pro][pro] |
| Page numbers | Standard | ✅ Have | **Page numbers** tool. | [online][online] |
| Page backgrounds | Standard | ⬜ Missing | Not built. A watermark placed behind the page covers most uses. | [pro][pro] |
| Add or edit links | Standard | ⬜ Missing | Not built. Existing links are kept by the page tools. | [pro][pro] |

### Organize

| Acrobat capability | Acrobat plan | PDF Studio | Notes | Source |
| --- | --- | --- | --- | --- |
| Merge files | Standard | ✅ Have | **Merge PDFs** with per-file page ranges and drag-to-reorder. | [online][online] |
| Split / extract pages | Standard | ✅ Have | **Split & extract**. | [online][online] |
| Reorder, rotate, delete, insert, duplicate pages | Standard | ✅ Have | **Organize pages**, with undo and redo. | [online][online] |
| Crop pages | Standard | ✅ Have | **Crop pages**: drag a frame, type margins, or auto-trim white margins. It sets the CropBox, as Acrobat does. | [pro][pro] |
| Create and edit bookmarks | Standard | ✅ Have | **Bookmarks**: nest, reorder and rename entries, or detect them from headings. | [pro][pro] |

### Optimize

| Acrobat capability | Acrobat plan | PDF Studio | Notes | Source |
| --- | --- | --- | --- | --- |
| Compress / reduce file size | Standard | ✅ Have | **Compress**: lossless restructuring, or image re-encoding at three strengths. | [online][online] |
| PDF Optimizer (fine-grained) and fast web view | Pro | 🟡 Partial | Three presets only. No linearization and no per-object audit. | [biz][biz] |

### Convert

| Acrobat capability | Acrobat plan | PDF Studio | Notes | Source |
| --- | --- | --- | --- | --- |
| Images to PDF (JPG, PNG, …) | Standard | ✅ Have | **Images to PDF**. | [online][online] |
| PDF to JPG/PNG | Standard | ✅ Have | **PDF to images**. | [online][online] |
| Word to PDF | Standard | 🟡 Partial | **Word to PDF** handles text, headings, lists, tables and images (via mammoth). Complex layouts, headers and footers are simplified. | [online][online] |
| PDF to Word | Standard | 🟡 Partial | **PDF to Word** produces a real .docx with headings, paragraphs, lists and bold/italic. It does not keep images, tables or the exact layout. | [online][online] |
| Excel to PDF | Standard | 🟡 Partial | **Excel / CSV to PDF** builds clean tables from XLSX, CSV or TSV, with repeated headers and fit-to-width. Charts and cell styling are not carried over. | [online][online] |
| PDF to Excel | Standard | ⬜ Missing | Not built. Table detection from PDF text is unreliable without a layout model. | [online][online] |
| PowerPoint to PDF | Standard | ⛔ Not feasible locally | No PowerPoint rendering engine runs in the browser. A faithful result needs Office or LibreOffice on a server. | [online][online] |
| PDF to PowerPoint | Standard | ⬜ Missing | Not built. The output would be one image per slide, which adds little over PDF to images. | [online][online] |
| HTML / web page to PDF | Standard | 🟡 Partial | **HTML / Markdown to PDF** works on pasted or dropped HTML or Markdown. Live URLs are not fetched, because the app never touches the network. | [pro][pro] |
| OCR: make scans searchable | Pro | 🟡 Partial | **OCR** adds an invisible, searchable text layer (Tesseract, on-device). English only. Needs http(s), so not file://, and WebAssembly SIMD. | [pro][pro] |
| PDF/A, PDF/X conversion and validation (preflight) | Pro | ⛔ Not feasible locally | Needs ICC profiles, full font embedding and a conformance validator (veraPDF / Adobe Preflight). None of these fit in a lightweight offline web app. | [biz][biz] |

### Forms

| Acrobat capability | Acrobat plan | PDF Studio | Notes | Source |
| --- | --- | --- | --- | --- |
| Fill in forms | Reader | ✅ Have | **Fill form** works on text, multiline, checkbox, radio and dropdown fields, with optional flattening. XFA forms are detected and explained. | [plans][plans] |
| Create fillable forms (Prepare Form) | Standard | ✅ Have | **Prepare form**: text, paragraph, checkbox, radio group, dropdown and signature fields. | [plans][plans] |
| Auto-detect form fields | Standard | ⬜ Missing | Not built. Adobe uses an AI model to place fields; here you place them by hand. | [plans][plans] |
| Form calculations and JavaScript actions | Pro | ⛔ Not feasible locally | Running a document’s own JavaScript would break the strict no-script CSP and the security model. | [pro][pro] |

### Sign

| Acrobat capability | Acrobat plan | PDF Studio | Notes | Source |
| --- | --- | --- | --- | --- |
| Fill & Sign: draw, type or upload a signature, initials, date | Reader | ✅ Have | **Sign & annotate**. | [plans][plans] |
| Request e-signatures, tracking, reminders, bulk send, web forms | Standard/Pro | ⛔ Not feasible locally | Needs a server to email signers, keep an audit trail and store agreements. That goes against the app’s rule that nothing is uploaded. | [plans][plans] |
| Certificate-based digital signatures and certification | Pro | ⛔ Not feasible locally | Needs the signer’s certificate (smart card or OS store, which the browser cannot reach), CMS signing and a trusted timestamp server. A **Prepare form** signature field can be signed later in Acrobat. | [pro][pro] |

### Review

| Acrobat capability | Acrobat plan | PDF Studio | Notes | Source |
| --- | --- | --- | --- | --- |
| Comment: highlight, underline, strikeout, sticky notes, text boxes | Reader | ✅ Have | **Comment & markup** saves real PDF annotations with appearance streams, so they show and stay editable in Acrobat. | [plans][plans] |
| Drawing markup: freehand, rectangle, ellipse, arrow/line | Reader | ✅ Have | **Comment & markup**. | [plans][plans] |
| Comment list, replies, shared review | Reader/Standard | 🟡 Partial | A comment list with an author name is included. Replies and shared or cloud review need a server. | [plans][plans] |
| Stamps | Reader | 🟡 Partial | Text and image stamps come from **Watermark & stamp**. There are no dynamic stamp libraries. | [pro][pro] |
| Compare two versions | Pro | 🟡 Partial | **Compare PDFs** shows a side-by-side word diff and a change list, and can export a marked-up copy. It compares text only: images and formatting are ignored. | [biz][biz] |

### Protect

| Acrobat capability | Acrobat plan | PDF Studio | Notes | Source |
| --- | --- | --- | --- | --- |
| Password to open (encrypt) | Standard | ✅ Have | **Protect PDF** uses AES-256, checks the output itself, and shows a strength meter. | [plans][plans] |
| Permissions (restrict printing, copying, editing) | Standard | ✅ Have | **Protect PDF → Restrictions** with a separate permissions password. | [plans][plans] |
| Remove password / unlock | Standard | ✅ Have | **Unlock PDF**, given the password. Every tool also prompts for a password when a protected file is opened. | [online][online] |
| Redact text and areas permanently | Pro | ✅ Have | **Redact**: search, patterns (email, phone, card, date, URL) and drawn areas. Redacted pages are flattened, so the content is truly gone, while unredacted text stays searchable. | [redact][redact] |
| Sanitize / remove hidden information | Pro | 🟡 Partial | Optional in **Redact**: removes metadata, XMP, attachments, scripts, open actions and bookmarks. It does not scan every hidden object type that Acrobat checks. | [redact][redact] |
| Certificate encryption / Microsoft Purview | Pro | ⛔ Not feasible locally | Needs a certificate infrastructure and Microsoft services. | [pro][pro] |

### Inspect

| Acrobat capability | Acrobat plan | PDF Studio | Notes | Source |
| --- | --- | --- | --- | --- |
| Document properties and metadata | Reader/Standard | ✅ Have | **Metadata** (edit or strip) and **PDF info**. | [pro][pro] |

### Accessibility

| Acrobat capability | Acrobat plan | PDF Studio | Notes | Source |
| --- | --- | --- | --- | --- |
| Accessibility checker, auto-tag, reading order (PDF/UA) | Pro | ⛔ Not feasible locally | Building a reliable tag structure needs document-layout AI and the full PDF/UA rule set. Doing it badly would do more harm than leaving it out. | [biz][biz] |

### Print production

| Acrobat capability | Acrobat plan | PDF Studio | Notes | Source |
| --- | --- | --- | --- | --- |
| Output Preview, Preflight, Convert Colors, Flattener, PDF/X | Pro | ⛔ Not feasible locally | Needs colour-managed rendering (ICC/CMYK separations) and Adobe’s preflight engine. | [print][print] |

### Automation

| Acrobat capability | Acrobat plan | PDF Studio | Notes | Source |
| --- | --- | --- | --- | --- |
| Action Wizard / batch processing | Pro | ⬜ Missing | Not built. Merge works on many files at once, but there is no recorded action sequence. | [pro][pro] |

### AI & cloud

| Acrobat capability | Acrobat plan | PDF Studio | Notes | Source |
| --- | --- | --- | --- | --- |
| AI Assistant, summaries, PDF Spaces | Add-on/Studio | ⛔ Not feasible locally | Needs a large language model. Running one on-device would mean gigabytes of downloads, and a cloud model would mean uploading files. | [plans][plans] |
| Cloud storage, share links, Adobe Express | Standard | ⛔ Not feasible locally | The app is deliberately serverless: files never leave the device. | [plans][plans] |
| Mobile app and camera scan | Reader | 🟡 Partial | The responsive web app installs as a PWA. On phones, Images to PDF can take camera photos. There is no edge detection or deskew. | [online][online] |

## How “Have” was verified

Every new tool has an end-to-end test in the project’s Puppeteer suite. Each test drives the real UI in Chrome and then inspects the output file with independent tools:

- **pypdf** checks annotation subtypes and appearance streams, form field types and values, CropBox and the outline.
- **pikepdf** checks that encrypted output needs a password and opens with it (AES-256, R6).
- **pdftotext** checks that redacted text is gone while the rest stays searchable, plus OCR text, Bates numbers and table text.
- **python-docx** checks PDF to Word headings and paragraphs.

The suite runs both over http(s) and from `file://`, and the service worker is checked offline.

## Sources

- **plans**: [Adobe Acrobat plans & pricing (Reader / Standard / Pro / Studio)](https://www.adobe.com/acrobat/plans.html)
- **pro**: [Adobe Acrobat Pro product page](https://www.adobe.com/acrobat/acrobat-pro.html)
- **biz**: [Acrobat for business: plans and feature comparison](https://www.adobe.com/acrobat/business/pricing-plans.html)
- **online**: [Adobe Acrobat online tools list](https://www.adobe.com/acrobat/online.html)
- **redact**: [Adobe Help: Redact sensitive content in PDFs](https://helpx.adobe.com/acrobat/desktop/protect-documents/redact-pdfs/redact.html)
- **print**: [Adobe Help: Print production tools overview](https://helpx.adobe.com/acrobat/using/print-production-tools-overview-acrobat.html)

Supplementary (third-party) cross-check of the Standard vs Pro split: https://www.mapsoft.com/posts/acrobat-standard-vs-pro.html

[plans]: https://www.adobe.com/acrobat/plans.html
[pro]: https://www.adobe.com/acrobat/acrobat-pro.html
[biz]: https://www.adobe.com/acrobat/business/pricing-plans.html
[online]: https://www.adobe.com/acrobat/online.html
[redact]: https://helpx.adobe.com/acrobat/desktop/protect-documents/redact-pdfs/redact.html
[print]: https://helpx.adobe.com/acrobat/using/print-production-tools-overview-acrobat.html
