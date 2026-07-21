# Lumio — Dejavoo iPOSpays "SPIn REST API" Reference

> **Nguồn:** https://app.theneo.io/dejavoo/spin/spin-rest-api-methods (và các trang con)
> Trích xuất trực tiếp từ tài liệu công khai bằng trình duyệt (accessibility tree + screenshot) ngày **2026-07-21**.
> **Nguyên tắc:** mọi tên field trong file này đều là **nguyên văn** từ tài liệu. Chỗ nào không đọc được đã ghi rõ ở mục [CHƯA CHẮC CHẮN](#chưa-chắc-chắn) — KHÔNG suy đoán.

---

## 1. Base URL

| Môi trường | Base URL |
|---|---|
| **Production** | `https://spinpos.net` |
| **Sandbox / Test** | `https://test.spinpos.net` |
| (Trong ví dụ cURL của doc) | `https://dev.spinpos.net` — đây là host nội bộ dùng cho ví dụ, **không** phải sandbox chính thức |

---

## 2. Cơ chế xác thực (QUAN TRỌNG)

### 2.1. Với các endpoint POST (Sale, Return, Void, Status, ...)

**Thông tin xác thực nằm TRONG JSON BODY — KHÔNG phải query string, KHÔNG phải header.**

Nguyên văn ví dụ cURL của endpoint Sale (đã mở panel phóng to để đọc đầy đủ):

```bash
curl --location 'https://dev.spinpos.net/v2/Payment/Sale' \
--data '{
  "Amount": 25,
  ...
  "Tpn": "Z11NATASHA98",
  "RegisterId": "",
  "Authkey": "zbhRAW9N6x",
  "SPInProxyTimeout": null,
  "CustomFields": {}
}'
```

URL **không có** query string. Ví dụ cURL trong doc **không hiển thị** header `Content-Type` nào (chỉ có `--location` và `--data`) — xem mục CHƯA CHẮC CHẮN.

Tên tham số (đúng hoa/thường, dùng trong body JSON):

| Tên field | Kiểu | Min length | Max length | Mô tả nguyên văn |
|---|---|---|---|---|
| `Tpn` | string | 10 | 12 | "Terminal profile number. Can be used to identify the terminal in SPIn Proxy environment." |
| `RegisterId` | string | 2 | 50 | "Terminal identifier for register. **[Obsolete]** Can be used to identify the terminal instead of Tpn in SPIn Proxy environment. Required if no Tpn." |
| `Authkey` | string | 10 | 10 | "Merchant's authorization password. Required if no SPInToken." |

> Lưu ý chính tả: là **`Authkey`** (chữ `k` thường), KHÔNG phải `AuthKey`.
> `RegisterId` đã bị đánh dấu **[Obsolete]** → nên dùng `Tpn`.
> Doc có nhắc tới "SPInToken" trong mô tả của `Authkey` nhưng **không có field `SPInToken` nào** trong danh sách body parameters của các endpoint đã đọc.

### 2.2. Với endpoint GET (Terminal Connection Status, Get Intermediate Status)

**Thông tin xác thực nằm trong QUERY STRING**, với tiền tố khác nhau tuỳ endpoint:

- `GET /v2/Common/TerminalStatus?request.tpn=&request.registerId=&request.authkey=`
- `GET /v2/IntermediateStatus/GetStatus?getRequest.tpn=&getRequest.referenceId=&getRequest.authkey=`

Chú ý: trong query string là **`request.authkey`** / **`getRequest.authkey`** — **toàn bộ chữ thường** sau dấu chấm, khác với `Authkey` trong body.

---

## 3. Bảng endpoint (lấy nguyên văn từ trang "SPIn REST API Methods")

| Method | Path | Ghi chú |
|---|---|---|
| POST | `/v2/Payment/Sale` | Thanh toán |
| POST | `/v2/Payment/Return` | Hoàn tiền (độc lập, không tham chiếu Sale) |
| POST | `/v2/Payment/TipAdjust` | Điều chỉnh tip |
| POST | `/v2/Payment/Auth` | Pre-auth |
| POST | `/v2/Payment/Capture` | Capture |
| POST | `/v2/Payment/Void` | Huỷ giao dịch trong batch |
| POST | `/v2/Report/Summary` | |
| POST | `/v2/Report/Daily` | |
| POST | `/v2/Common/Printer` | |
| POST | `/v2/Payment/Status` | Tra cứu 1 giao dịch |
| POST | `/v2/Payment/StatusList` | Tra cứu nhiều giao dịch theo index |
| POST | `/v2/Payment/OfflineStatus` | |
| POST | `/v2/Payment/Settle` | |
| POST | `/v2/Common/GetSignature` | |
| POST | `/v2/Common/UserChoice` | |
| POST | `/v2/Common/UserInput` | |
| POST | `/v2/Common/Disclaimer` | |
| **GET** | `/v2/Common/TerminalStatus?request.tpn=&request.registerId=&request.authkey=` | Kiểm tra máy online/offline |
| POST | `/v2/TableApp/SelectInvoice` | |
| POST | `/v2/TableApp/PaymentInvoice` | |
| POST | `/v2/Payment/AbortTransaction` | Huỷ giao dịch đang chạy trên máy |
| POST | `/v2/Payment/Cart` | |
| POST | `v2/Payment/GetCard` | (doc ghi thiếu dấu `/` đầu — nguyên văn) |
| POST | `/v2/Payment/Balance` | Hiển thị trong sidebar là "Balance" |
| **GET** | `/v2/IntermediateStatus/GetStatus?getRequest.tpn=&getRequest.referenceId=&getRequest.authkey=` | Trạng thái trung gian trong lúc giao dịch chạy |
| POST | `/v2/IntermediateStatus/...` | Post Intermediate Status — **chưa đọc path chính xác** |

Ngoài ra còn nhóm `Gift` (Activate/Deactivate/Inquire/Redeem/Refund/Reissue/Reload/Void), `L2L3`, `CEDP`, `AutoRental`, `Post Callback`, `Callback Get Last Callback`, `Capture CEDP`, `Upload Transaction` — **chưa đọc chi tiết** (ngoài phạm vi yêu cầu).

---

## 4. `POST /v2/Payment/Sale`

**Mô tả nguyên văn:** "Sale is the most common request that user to do payment on a terminal. All the responses have `GeneralResponse` section that informs about successful result or error. See Error Codes and Messages."

### 4.1. Body Parameters (đầy đủ, đúng thứ tự trong doc)

| Field | Kiểu | Required | Ràng buộc | Mô tả nguyên văn |
|---|---|---|---|---|
| `Amount` | number (double) | **✔ Required** | | "Total amount of the transaction." |
| `TipAmount` | number (double) | | | "Tip amount of the transaction." |
| `ExternalReceipt` | string | | | "Text in receipt format that terminal prints as a part of terminal receipt" |
| `CustomFee` | number (double) | | | "CustomFee of the transaction." |
| `Cart` | object | | | "Cart in payment request" — con: `Amounts` (array, **Required**), `CashPrices` (array), `Items` (array, **Required**) |
| `PaymentType` | string | **✔ Required** | enum: `Credit`, `Debit`, `EBT_Food`, `EBT_Cash`, `Card`, `Cash`, `Check`, `Gift` | "Indicates electronic data capture (EDC) type." |
| **`ReferenceId`** | string | **✔ Required** | min 1, **max 50** | **"Alphanumeric SPIn transaction identifier. Has to be unique within one batch."** ← ĐÂY là field ID duy nhất do POS sinh ra |
| `PrintReceipt` | string | | enum: `No`, `Both`, `Merchant`, `Customer` | "Indicates if any of receipt copies should be printed after the transaction." |
| `GetReceipt` | string | | enum: `No`, `Both`, `Merchant`, `Customer` | "Indicates if any of receipt copies should be returned in response." |
| `MerchantNumber` | integer (int32) | | min 1, max 5 | "Merchant number for multi-merchant environment. If not present in multi-merchant environment, transaction will be cancelled." |
| `InvoiceNumber` | string | | max 50 | "Unique alphanumeric invoice number." |
| `CaptureSignature` | boolean | | | "Indicates whether customer signature should be captured or not in course of transaction." |
| `GetExtendedData` | boolean | | | "Indicates whether extended transaction data should be returned or not." |
| `IsReadyForIS` | boolean | | | "Indicates whether register is ready to receive intermediate status or not." |
| `CallbackInfo` | object | | con: `Url` (string) | "Information for callback with transaction result." / `Url`: "Url of the callback receiver" |
| `ReconId` | string | | min 1, max 10 | "Used for reconciliation purposes. This field is applicable only for Fiserv North transactions and it is optional. It contains an alphanumeric reference ID that links the transaction to its corresponding settlement record in Fiserv." |
| `IsvId` | string | | min 1, max 16 | "This is the unique identifier generated by iPOSpays for each ISV. It must be sent to associate the transaction and the merchant with the corresponding ISV." |
| `Tpn` | string | | min 10, max 12 | (xem mục 2) |
| `RegisterId` | string | | min 2, max 50 | (xem mục 2, [Obsolete]) |
| `Authkey` | string | | min 10, max 10 | (xem mục 2) |
| `SPInProxyTimeout` | integer (int32) | | min 1, **max 720** | "Timeout for processing transaction with SPIn proxy. If null, the default timeout will be used." (**đơn vị không được ghi trong doc**) |
| `CustomFields` | object | | | "A collection of custom fields in key-value format." |

> **Không có** field nào tên `RefId`, `OrderId`, `SaleType`, hay `IdempotencyKey`.
> Cặp ID: `ReferenceId` (bắt buộc, unique trong 1 batch, dùng cho Void/Status) + `InvoiceNumber` (tuỳ chọn).

### 4.2. JSON request mẫu (nguyên văn từ doc)

```json
{
  "Amount": 25,
  "TipAmount": 2.5,
  "ExternalReceipt": "",
  "CustomFee": 25,
  "Cart": {
    "Amounts": [ { "Name": "", "Value": null } ],
    "CashPrices": [ { "Name": "", "Value": null } ],
    "Items": [
      {
        "Name": "",
        "Price": null,
        "UnitPrice": null,
        "Quantity": null,
        "AdditionalInfo": "",
        "CustomInfos": [ { "Name": "", "Value": null } ],
        "Modifiers": [
          { "Name": "", "Options": [ { "Name": "", "Price": null, "Quantity": null } ] }
        ]
      }
    ]
  },
  "PaymentType": "Credit",
  "ReferenceId": "111",
  "PrintReceipt": "No",
  "GetReceipt": "No",
  "MerchantNumber": null,
  "InvoiceNumber": "",
  "CaptureSignature": false,
  "GetExtendedData": true,
  "IsReadyForIS": false,
  "CallbackInfo": { "Url": "" },
  "ReconId": "",
  "IsvId": "",
  "Tpn": "Z11NATASHA98",
  "RegisterId": "",
  "Authkey": "zbhRAW9N6x",
  "SPInProxyTimeout": null,
  "CustomFields": {}
}
```

### 4.3. JSON response 200 mẫu — giao dịch được duyệt (tab "DvPay" trong doc, có giá trị thật)

```json
{
  "Amounts": {
    "TotalAmount": 1.05,
    "Amount": 1,
    "TipAmount": null,
    "FeeAmount": 0.03,
    "TaxAmount": 0.02
  },
  "GeneralResponse": {
    "HostResponseCode": "00",
    "HostResponseMessage": "APPROVAL VTLMC1 ",
    "ResultCode": "0",
    "StatusCode": "0000",
    "Message": "Approved",
    "DetailedMessage": "APPROVAL VTLMC1"
  },
  "PaymentType": "Credit",
  "TransactionType": "Sale",
  "AuthCode": "VTLMC1",
  "ReferenceId": "d6c871b6a580",
  "InvoiceNumber": "1",
  "SerialNumber": "WP20231Q40000412",
  "BatchNumber": "103",
  "TransactionNumber": "1",
  "Voided": false,
  "ExtendedDataByApplication": {
    "Mastercard": {
      "Amount": "1.00",
      "InvNum": "1",
      "CardType": "MASTERCARD",
      "BatchNum": "103",
      "Tip": "0.00",
      "CashBack": "0.00",
      "Fee": "0.03",
      "AcntLast4": "4111",
      "BIN": "541333",
      "SVC": "0.00",
      "TotalAmt": "1.05",
      "DISC": "0.00",
      "Donation": "0.00",
      "SHFee": "0.00",
      "RwdPoints": "0",
      "RwdBalance": "0",
      "Language": "English",
      "EntryType": "CHIP Contactless",
      "TableNum": "0",
      "TaxCity": "0.01",
      "TaxState": "0.01",
      "TaxReducedState": "0.00",
      "AcntFirst4": "5413",
      "TaxAmount": "0.00",
      "TransactionID": "1212MCC111383  ",
      "ExtraHostData": "00-APPROVAL-Approved and Completed",
      "AID": "A0000000041010",
      "AppName": "Mastercard",
      "TVR": "0000008001",
      "TSI": "2000",
      "IAD": "0102030405060708"
    }
  },
  "CardData": {
    "CardType": "Mastercard",
    "EntryType": "ChipContactless",
    "Last4": "4111",
    "First4": "5413",
    "BIN": "541333",
    "Name": ""
  },
  "EMVData": {
    "ApplicationName": "Mastercard",
    "AID": "A0000000041010",
    "TVR": "0000008001",
    "TSI": "2000",
    "IAD": "0102030405060708",
    "ARC": ""
  }
}
```

### 4.4. JSON response mẫu khi LỖI (tab "Error" của Sale — vẫn là HTTP 200)

```json
{
  "Amounts": { "Amount": null, "TipAmount": null, "FeeAmount": null, "TaxAmount": null },
  "GeneralResponse": {
    "ResultCode": "1",
    "StatusCode": "1011",
    "Message": "Canceled",
    "DetailedMessage": "Duplicate Reference Id"
  },
  "PaymentType": "Credit",
  "TransactionType": "Sale",
  "ReferenceId": "d6c871b6a580",
  "InvoiceNumber": "",
  "SerialNumber": "P3211229220555"
}
```

> ⚠️ **Rất quan trọng:** lỗi nghiệp vụ được trả về với **HTTP 200** + `GeneralResponse.ResultCode != "0"`. Phải parse `ResultCode`/`StatusCode`, **không** được chỉ dựa vào HTTP status.

---

## 5. Response schema chung

### 5.1. `GeneralResponse`

Có 2 biến thể trong doc:
- "General response for **payment** request" — có thêm `HostResponseCode` + `HostResponseMessage`
- "General response for **any** request" — không có 2 field đó

| Field | Kiểu | Required | Mô tả nguyên văn |
|---|---|---|---|
| `HostResponseCode` | string | | "This response code comes from the payment processor as is. It is usually referring to ISO 8583-1987." |
| `HostResponseMessage` | string | | "Meanings for host response code that comes from the payment processor as is. It is usually referring to ISO 8583-1987." |
| `ResultCode` | string | **✔** | "General result code [0 - Success result, 1 - Error on terminal, 2 - Error on SPIn proxy side]" — enum: `Ok`, `TerminalError`, `ApiError`; **giá trị trên dây là chuỗi `"0"` / `"1"` / `"2"`** |
| `StatusCode` | string | **✔** | "Indicates 4-digit response code for specific situation." (bảng đầy đủ ở mục 12) |
| `Message` | string | **✔** | "Text message that describes response." |
| `DetailedMessage` | string | **✔** | "More detailed message that describes response." |
| `DelayBeforeNextRequest` | number (double) | | "Max delay before next request, if terminal is busy" — bảng trên trang Error Codes ghi rõ: "**Time in seconds** that recommended to wait before send next request. This returns when SPIn Proxy service is busy with previous request." |

### 5.2. `Amounts`

| Field | Kiểu | Mô tả nguyên văn |
|---|---|---|
| `TotalAmount` | number (double) | "Amount with fee and tip." |
| `Amount` | number (double) | "Amount with tip." |
| `TipAmount` | number (double) | "Tip amount of the transaction." |
| `FeeAmount` | number (double) | "Fee amount of the transaction." |
| `TaxAmount` | number (double) | "Tax amount of the transaction." |

### 5.3. Các field kết quả giao dịch ở cấp root (response của Sale / Return / Void / Auth / Capture / Status)

| Field | Kiểu | Mô tả nguyên văn |
|---|---|---|
| `PaymentType` | string | "Indicates electronic data capture ['Credit', 'Debit', 'EBT', 'Card']." (enum như request) |
| `TransactionType` | string | "Indicates Transaction Type (Sale, Void, Auth, etc)." |
| `Amounts` | object | (xem 5.2) |
| **`AuthCode`** | string | "Authorization code provided by payment processor." ← **approval / auth code** |
| **`ReferenceId`** | string | "Alphanumeric unique SPin transaction identifier." (echo lại ReferenceId đã gửi) |
| `InvoiceNumber` | string | "Unique invoice number." |
| `SerialNumber` | string | "Device Serial Number." |
| **`BatchNumber`** | string | "Current batch number." |
| **`TransactionNumber`** | string | "Transaction number within batch." |
| `Voided` | boolean | "Indicates whether transaction was voided or not." |
| `Signature` | string | "Indicates customer signature if it was captured." |
| `IPosToken` | string | "Using the token obtained in sale response POS can perform new authorisation using \"Transact\" api o..." (mô tả bị cắt trong tài liệu) |
| `Token` | string | "This token could be required for future transactions using the same card" |
| **`RRN`** | string | "Reference Retrieval Number provided by iPOSPay Gateway. Uses for iPos gateway Api." |
| **`PNReferenceId`** | string | "Unique transaction reference number provided by the payment processor." |
| `MerchantNumber` | integer (int32) | "Merchant number for multi-merchant environment." |
| `MerchantName` | string | "Merchant name for multi-merchant environment." |
| `ExtendedDataByApplication` | object (có nơi ghi array) | Dữ liệu thô theo từng ứng dụng thanh toán trên máy (xem mẫu ở 4.3) |
| `CardData` | object | (xem 5.4) |
| `EMVData` | object | (xem 5.5) |
| `Receipts` | object | con: `Customer`, `Merchant` |
| `L2L3ValidationError` | object | con: `Description`, `PoNumber`, `PurchaseIdentifier`, `SummaryCommodityCode`, `LineItemCount`, `TaxAmount`, `Quantity`, `UnitOfMeasure`, `UnitCost`, `TaxRate`, `DiscountAmount`, `DebitCreditIndicator`, `ExtLineAmount`, `QuantityExpIndicator`, `UnitPriceDecimal` |
| `AutoRentalValidationError` | object | (nhiều field liên quan thuê xe — không liên quan salon) |

> **Không có field `Timestamp` / `TransactionDateTime` ở cấp root** trong schema Sale/Void/Return/Status. Thời gian chỉ xuất hiện ở `GET /v2/IntermediateStatus/GetStatus` (`StatusDateTime`). Xem CHƯA CHẮC CHẮN.

### 5.4. `CardData`

| Field | Kiểu | Mô tả nguyên văn |
|---|---|---|
| `CardType` | string | "Type of Bank Card." — enum: `None`, `Visa`, `Mastercard`, `Amex`, `Discover`, `JCB`, `Unknown` |
| `EntryType` | string | "Entry method used to provide card data." — enum: `None`, `Chip`, `Swipe`, `ChipContactless`, `Contactless`, `Manual`, `Unknown` |
| `Last4` | string | "Last 4 digits of card number." |
| `First4` | string | "First 4 digits of card number." |
| `BIN` | string | "Bank Identification Number." |
| `ExpirationDate` | string | "Card expiration date (MMYY format)." |
| `Name` | string | "Card holder name." |
| `CardBrand` | string | "Card brand name." |

> Không có field "masked PAN" đầy đủ. Ghép `First4` + `Last4` (+ `BIN`) để hiển thị.

### 5.5. `EMVData`

`ApplicationName`, `AID`, `TVR`, `TSI`, `IAD`, `ARC` (tất cả string).

---

## 6. `POST /v2/Payment/Void`

**Mô tả nguyên văn:**
- "Void operation cancels operation that it is referring to. Void need to do before Settlement. You can..." *(phần sau bị cắt)*
- "Void may be done for [Sale], [Return], [Auth], [Capture] requests."
- ➜ **"To do void you need to know ReferenceID and amount of transaction that you void."**

### Body Parameters

| Field | Kiểu | Required | Ghi chú |
|---|---|---|---|
| `Amount` | number (double) | **✔ Required** | "Total amount of the transaction." — số tiền của giao dịch GỐC |
| `PaymentType` | string | **✔ Required** | enum như Sale |
| **`ReferenceId`** | string | **✔ Required** | `ReferenceId` của **giao dịch gốc** |
| `PrintReceipt` | string | | |
| `GetReceipt` | string | | |
| `MerchantNumber` | integer (int32) | | |
| `CaptureSignature` | boolean | | |
| `GetExtendedData` | boolean | | |
| `IsReadyForIS` | boolean | | |
| `CallbackInfo` | object | | |
| `ReconId` | string | | |
| `IsvId` | string | | |
| `Tpn` / `RegisterId` / `Authkey` | string | | xác thực |
| `SPInProxyTimeout` | integer (int32) | | |
| `CustomFields` | object | | |

> **Void KHÔNG có field `InvoiceNumber`** (khác Sale/Return). Không có `PaymentId`, không có `RefId`.

### cURL mẫu (nguyên văn)

```bash
curl --location 'https://dev.spinpos.net/v2/Payment/Void' \
--data '{
  "Amount": 1,
  "PaymentType": "Credit",
  "ReferenceId": "d6c871b6a580",
  "PrintReceipt": "No",
  "GetReceipt": "No",
  "MerchantNumber": null,
  "CaptureSignature": false,
  "GetExtendedData": true,
  "IsReadyForIS": false,
  "CallbackInfo": { "Url": "" },
  "ReconId": "",
  "IsvId": "",
  "Tpn": "z11invtest69",
  "RegisterId": "",
  "Authkey": "JZiRUusizc",
  "SPInProxyTimeout": null,
  "CustomFields": {}
}'
```

Response: cùng schema với Sale (GeneralResponse + các field giao dịch).

---

## 7. `POST /v2/Payment/Return` (Refund)

**Mô tả nguyên văn (đọc đầy đủ qua screenshot):**

> "Return is an independent operation and it does not relate to any Sale transaction. Please use a unique ReferenceID for Return request. You may do return on any amount. For a terminal app Return operation is not related to any Sale that you did in the past. Return does charge back and behaves as Sale only vice-versa and add money on card balance."

**Kết luận:**
- Return **KHÔNG** tham chiếu tới giao dịch gốc. Không có field nào để trỏ về Sale cũ.
- Phải dùng **`ReferenceId` MỚI, duy nhất** cho lệnh Return.
- **Hỗ trợ hoàn một phần**: "You may do return on any amount" — chỉ cần đặt `Amount` bằng số tiền muốn hoàn.
- Khách phải quẹt/tap lại thẻ trên máy (vì là thao tác độc lập trên terminal).

### Body Parameters

Giống Sale nhưng **không có** `TipAmount`, `ExternalReceipt`, `CustomFee`, `Cart`:

`Amount` (**Required**), `PaymentType` (**Required**), `ReferenceId` (**Required**, min 1 / max 50), `PrintReceipt`, `GetReceipt`, `MerchantNumber`, `InvoiceNumber`, `CaptureSignature`, `GetExtendedData`, `IsReadyForIS`, `CallbackInfo`, `ReconId`, `IsvId`, `Tpn`, `RegisterId`, `Authkey`, `SPInProxyTimeout`, `CustomFields`.

### cURL mẫu (nguyên văn)

```bash
curl --location 'https://dev.spinpos.net/v2/Payment/Return' \
--data '{
  "Amount": 1,
  "PaymentType": "Credit",
  "ReferenceId": "3ecebccef5d4",
  "PrintReceipt": "No",
  "GetReceipt": "No",
  "MerchantNumber": null,
  "InvoiceNumber": "3",
  "CaptureSignature": false,
  "GetExtendedData": true,
  "IsReadyForIS": false,
  "CallbackInfo": { "Url": "" },
  "ReconId": "",
  "IsvId": "",
  ...
}'
```

> **Chọn Void hay Return?** Sơ đồ "Transaction types scheme" của doc: `Sale` → (`Tip adjust`, `Void`); `Refund/Return` → (`Void`).
> Trong batch chưa settle: dùng **Void** (huỷ hẳn, có tham chiếu ReferenceId gốc).
> Sau khi đã settle: dùng **Return** (giao dịch mới, độc lập).

---

## 8. `POST /v2/Payment/Status` — CHỐNG CHARGE 2 LẦN

Trang này **không có đoạn mô tả nào** trong doc (phần mô tả để trống hoàn toàn) — chỉ có bảng tham số.

### Body Parameters (vào)

| Field | Kiểu | Required | Ràng buộc |
|---|---|---|---|
| `TransactionNumber` | integer (int32) | | min 1, max 9999 — "The number of transaction wants to retrieve." |
| `PaymentType` | string | **✔ Required** | enum như Sale |
| **`ReferenceId`** | string | **✔ Required** | min 1, max 50 — "Alphanumeric SPIn transaction identifier. Has to be unique within one batch." |
| `PrintReceipt` | string | | |
| `GetReceipt` | string | | |
| `MerchantNumber` | integer (int32) | | |
| `CaptureSignature` | boolean | | |
| `GetExtendedData` | boolean | | |
| `IsReadyForIS` | boolean | | |
| `CallbackInfo` | object | | |
| `ReconId`, `IsvId` | string | | |
| `Tpn`, `RegisterId`, `Authkey` | string | | xác thực |
| `SPInProxyTimeout` | integer (int32) | | |
| `CustomFields` | object | | |

> **Status KHÔNG có `Amount`, KHÔNG có `InvoiceNumber`.** Tra cứu bằng `ReferenceId` (và/hoặc `TransactionNumber`).

### Response (ra)

Y hệt schema response của Sale: `GeneralResponse` + `PaymentType`, `TransactionType`, `Amounts`, `AuthCode`, `ReferenceId`, `InvoiceNumber`, `SerialNumber`, `BatchNumber`, `TransactionNumber`, `Voided`, `Signature`, `IPosToken`, `Token`, `RRN`, `PNReferenceId`, `MerchantNumber`, `MerchantName`, `ExtendedDataByApplication`, `CardData`, `EMVData`, `Receipts`, `L2L3ValidationError`, `AutoRentalValidationError`.

### cURL mẫu (nguyên văn)

```bash
curl --location 'https://dev.spinpos.net/v2/Payment/Status' \
--data '{
  "TransactionNumber": null,
  "PaymentType": "Credit",
  "ReferenceId": "",
  "PrintReceipt": "No",
  "GetReceipt": "No",
  "MerchantNumber": null,
  "CaptureSignature": false,
  "GetExtendedData": false,
  "IsReadyForIS": false,
  "CallbackInfo": { "Url": "" },
  "ReconId": "",
  "IsvId": "",
  "Tpn": "",
  "RegisterId": "",
  "Authkey": "",
  "SPInProxyTimeout": null,
  "CustomFields": {}
}'
```

### Cách suy luận kết quả (dựa trên các mã đã xác nhận trong doc)

- Nếu `GeneralResponse.StatusCode == "0000"` → giao dịch tồn tại và đã được duyệt.
- Nếu `StatusCode == "1001"` (Not Found) → doc ghi rõ một trong các nguyên nhân là **"Status request could not find a matching transaction record"** ⇒ giao dịch **chưa** phát sinh.
- Nếu `StatusCode == "2009"` (Transaction not found) → SPIn Proxy không tìm thấy giao dịch.

---

## 9. `POST /v2/Payment/StatusList`

| Field | Kiểu | Required | Ràng buộc |
|---|---|---|---|
| `PaymentType` | string | **✔ Required** | enum như Sale |
| `MerchantNumber` | integer (int32) | | min 1, max 5 |
| `TransactionFromIndex` | integer (int32) | **✔ Required** | min 1, max 5000 |
| `TransactionToIndex` | integer (int32) | **✔ Required** | min 1, max 5000 |
| `Tpn`, `RegisterId`, `Authkey` | string | | |
| `SPInProxyTimeout` | integer (int32) | | min 1, max 720 |
| `CustomFields` | object | | |

Response: `Transactions` (array các object giao dịch) + `GeneralResponse`.

cURL mẫu: `"TransactionFromIndex": 1, "TransactionToIndex": 10, "Tpn": "Z11NATASHA98", "Authkey": "zbhRAW9N6x"`.

---

## 10. `GET /v2/Common/TerminalStatus` — Terminal Connection Status

**Đây là GET, không phải POST.**

URL đầy đủ (nguyên văn từ doc):

```
GET https://spinpos.net/v2/Common/TerminalStatus?request.tpn=&request.registerId=&request.authkey=
```

cURL trong doc (rút gọn, không kèm query):
```bash
curl --location 'https://dev.spinpos.net/v2/Common/TerminalStatus'
```

### Query Parameters

| Tên (nguyên văn) | Kiểu | Required | Mô tả nguyên văn |
|---|---|---|---|
| `request.tpn` | string | (không đánh dấu Required) | "Terminal profile number. Can be used to identify the terminal in SPIn Proxy environment. Required if..." *(bị cắt)* |
| `request.registerId` | string | | "Terminal identifier for register. [Obsolete] Can be used to identify the terminal instead of Tpn in SPIn Proxy environment. Required if no Tpn." |
| `request.authkey` | string | | "Merchant's authorization password. Required if no SPInToken." |

### Response (200 / 400 / 404 — cùng schema)

| Field | Kiểu | Mô tả nguyên văn |
|---|---|---|
| **`TerminalStatus`** | string | "Terminal status - Online, Offline, or Not Found" — enum: **`Offline`**, **`Online`**, **`NotFound`** |
| `Tpn` | string | "Terminal profile number." |
| `ErrorDescription` | string | "Description of validations error for invalid request" |

JSON mẫu trong doc:
```json
{
  "TerminalStatus": "Offline",
  "Tpn": "",
  "ErrorDescription": ""
}
```

HTTP status có thể là **200**, **400** (BadRequest) hoặc **404** (NotFound) — cả ba đều trả cùng schema.

➜ Máy online ⟺ `TerminalStatus === "Online"`.

---

## 11. Các lệnh phụ trợ liên quan chống double-charge

### 11.1. `POST /v2/Payment/AbortTransaction`

Huỷ giao dịch **đang chạy** trên máy.

| Field | Kiểu | Required |
|---|---|---|
| `ReferenceId` | string | (không đánh dấu Required) |
| `Tpn` | string | |
| `RegisterId` | string | |
| `Authkey` | string | |
| `CustomFields` | object | |

cURL mẫu:
```bash
curl --location 'https://dev.spinpos.net/v2/Payment/AbortTransaction' \
--data '{ "ReferenceId": "", "Tpn": "", "RegisterId": "", "Authkey": "", "CustomFields": {} }'
```

Response 200 chỉ có `GeneralResponse`:
```json
{ "GeneralResponse": { "ResultCode": "0", "StatusCode": "0000", "Message": "", "DetailedMessage": "", "DelayBeforeNextRequest": null } }
```

### 11.2. `GET /v2/IntermediateStatus/GetStatus`

```
GET https://spinpos.net/v2/IntermediateStatus/GetStatus?getRequest.tpn=&getRequest.referenceId=&getRequest.authkey=
```

| Query param | Kiểu | Required | Mô tả nguyên văn |
|---|---|---|---|
| `getRequest.tpn` | string | **✔ Required** | "Terminal profile number. Can be used to identify the terminal." |
| `getRequest.referenceId` | string | | "Reference Id Can be used to identify the transaction." |
| `getRequest.authkey` | string | | "Merchant's authorization password." |

Response 200: `StatusDateTime` (string date-time), `StatusText` (string), `StatusCode` (string). HTTP 400 / 404 cũng có.

> Muốn nhận intermediate status thì gửi `IsReadyForIS: true` trong lệnh Sale.

---

## 12. Timeout

Doc **KHÔNG** có mục riêng nói về thời gian máy chờ khách quẹt thẻ. Thông tin timeout duy nhất tìm được nằm ở bảng mã lỗi, mã **2007**:

> **"Terminal did not provide response during timeout time. Default timeout is 120 seconds. Settlement default timeout is 420 seconds"**

Và tham số điều chỉnh:

| Tham số | Kiểu | Min | Max | Mô tả nguyên văn |
|---|---|---|---|---|
| `SPInProxyTimeout` | integer (int32) | 1 | 720 | "Timeout for processing transaction with SPIn proxy. If null, the default timeout will be used." |

Ngoài ra `GeneralResponse.DelayBeforeNextRequest` = "Time in seconds that recommended to wait before send next request. This returns when SPIn Proxy service is busy with previous request." (trả về kèm mã **2008 Terminal in use**).

**Tóm tắt để code:** đặt HTTP client timeout của Lumio **lớn hơn** `SPInProxyTimeout` (hoặc lớn hơn 120s nếu để null). Nếu vẫn timeout → **BẮT BUỘC** gọi `/v2/Payment/Status` với cùng `ReferenceId` trước khi làm bất cứ điều gì khác.

---

## 13. Bảng mã lỗi / kết quả (`GeneralResponse.StatusCode`)

### 13.1. `ResultCode` (cấp 1)

| Giá trị trên dây | Tên enum | Ý nghĩa (nguyên văn) |
|---|---|---|
| `"0"` | `Ok` | Success result |
| `"1"` | `TerminalError` | Error on terminal |
| `"2"` | `ApiError` | Error on SPIn proxy side |

### 13.2. Quy tắc dải mã (nguyên văn trang Error Codes)

- `0xxx` — "successful responses from terminal application. The response comes from a terminal application..."
- `1xxx` — "error responses from terminal app. The response was sent from a terminal."
- `2xxx` — "error response from SPIN Proxy server. The response did not reach terminal or terminal did no..." *(bị cắt)*

### 13.3. `0xxx` — Successful responses from terminal application

| StatusCode | Detailed Message | Description |
|---|---|---|
| **`0000`** | **Approved** | **"The transaction or a service request was approved"** ← **ĐÂY LÀ MÃ "ĐÃ DUYỆT"** |
| `0001` | Partial Approval | "The transaction was partially approved by the host" / "One or more (but not all) applications approved the settlement request" |

> Doc có ghi chú: "On the test host for partial approval you need to make a sale with $50 base amount and $2 tips - TSY..." *(bị cắt)*

### 13.4. `1xxx` — Error responses from terminal app

| StatusCode | Detailed Message | Description (nguyên văn, rút gọn) |
|---|---|---|
| `1000` | Terminal Busy | Máy đang xử lý request SPIN khác / máy ở chế độ SPIN bypass |
| `1001` | Not Found | Get/Set Parameter không tìm thấy; **Status request could not find a matching transaction record**; Void request không tìm thấy; Tip Adjustment không tìm thấy; Get request không tìm thấy; TSYS level 3 không tìm thấy |
| `1002` | Not Implemented | "Unsupported service requested (Invoice, GetCard, etc.)" |
| `1003` | Not Supported | Get PIN / Tip Adjustment / Upload SnF / Batch Report không tìm được payment application; Disclaimer trên máy không có cảm ứng |
| `1004` | Not Allowed | Void Auth với processor không cho phép; giao dịch voucher non-EBT; nhập tay thẻ Debit khi processor không phải BridgePay; gửi tip trong lệnh Auth; gửi custom fee trong lệnh Auth hoặc EBT |
| `1005` | Low Battery | "Battery charge is low" |
| `1006` | Internal Error | Máy in hết giấy; lỗi nội bộ bất ngờ |
| `1007` | Format Error | "The SPIN request uses an unsupported markup language or the request is malformed" |
| `1008` | Wrong Payment Or Transaction Type | "The transaction request uses incorrect or inapplicable payment or transaction type" |
| `1009` | Authentication Failed | "Authentication failed (auth key mismatch). Usually this means need to pull parameters on a terminal..." |
| `1010` | Missing Reference ID | "The reference ID is missing in a request that requires it" |
| **`1011`** | **Duplicate Reference ID** | **"A transaction with a requested reference ID already exists in the batch"** ← chống trùng |
| `1012` | Canceled | "User cancelled the transaction or it was interrupted for an unknown reason" |
| `1013` | Bad Request | Nhiều nguyên nhân: printer request sai; User Choice không có item; User Input thiếu input type; thiếu tham số bắt buộc; không có payment/transaction type; amount = 0 khi không hợp lệ; độ dài amount sai; fee+tip+cashback > tổng tiền; clerk ID sai; Tip Adjustment thiếu amount/tip/referenceId; Get request thiếu/sai range; TSYS level 3 thiếu auth code |
| `1014` | Communication Error | "Communication error with a third party host occurred" |
| **`1015`** | **Declined** | Load/Delete Key thất bại; Settlement khi chưa cài payment application; **"A transaction is declined offline or by the host"**; settlement bị host từ chối |
| `1016` | Payment Type Mismatch | "Payment type of the transaction is not applicable for the card" |
| `1017` | Incorrect Merchant ID | "Invalid merchant ID specified in request" |
| `1018` | PINpad Communication Error | "A communication error with the PINpad device occurred" |
| `1019` | No Debit Keys Loaded | "An encrypted PIN was requested by the transaction, but the terminal has no keys loaded" |
| `1020` | No Open Batch | "No application that has an open batch during a settlement request" |
| `1021` | Pending SnF Transaction | "Settlement has been requested, but the terminal is in SnF mode and has pending transactions to upload" |
| `1022` | Untipped Transactions Remain | "Settlement has been requested, but the terminal is in restaurant mode and has untipped transactions" |
| `1023` | Open Tab | "Settlement has been requested, but the terminal has an open tab" |
| `1024` | KMS Failed | *(chỉ có trong enum của schema, không có trong bảng trên trang Error Codes)* |
| `1030` | Terminal Was Disconnected | *(chỉ có trong enum)* |
| `1500` | Signature Not Captured | *(chỉ có trong enum)* |
| `1999` | Unknown Terminal Response | *(chỉ có trong enum)* |

### 13.5. `20xx` — Error response from SPIN Proxy Server

| StatusCode | Detailed Message | Description (nguyên văn) |
|---|---|---|
| `2001` | Terminal not connected to SPIn Proxy server | "need to check that terminal has connection to the Internet and to SPIn proxy and shows that it is ready for transaction" |
| `2002` | Active AuthKey not found | "AuthKey in request does is wrong or does not exists. Usually this means misprint in AuthKey" |
| `2003` | Register not found | "TPN wrong or does not exists" / "Possible that the request goes to wrong server test instead of prod or vice-versa" |
| `2004` | Route not found | "TPN does not have configuration for SPIn proxy" |
| `2005` | Active route not found | "Connection was blocked on server side" / "Terminal is not active" / "Two or more devices used the same TPN" |
| `2006` | Not pars request | "Invalid request it may happen if self extra space in some values" |
| **`2007`** | **The operation has timed out** | **"Terminal did not provide response during timeout time. Default timeout is 120 seconds. Settlement default timeout is 420 seconds"** |
| `2008` | Terminal in use | "Terminal operate previous request in this case API returns `DelayBeforeNextRequest` in `GeneralResponse` as a recommendation to specify time when timeout will happen." |
| `2009` | Transaction not found | *(bảng để trống phần Description)* |
| `2010` | Communication error | *(bảng để trống)* — enum trong schema ghi đầy đủ: "Communication error. Send request one more time" |
| `2011` | Terminal is not available | *(bảng để trống)* |

### 13.6. `21xx` — Error response from SPIN Proxy Server, Async Requests with Call-back

| StatusCode | Detailed Message |
|---|---|
| `2101` | Callback Url was not specified |
| `2102` | Invalid XML document |
| `2110` | Internal exception |

### 13.7. Mã chỉ có trong enum của schema (không có trong bảng trang Error Codes)

| StatusCode | Tên |
|---|---|
| `2201` | Invalid request data |
| `2301` | There is no processing request now |

---

## 14. Gợi ý logic chống charge 2 lần (suy ra từ spec, KHÔNG phải trích dẫn doc)

> Phần này là **kết luận kỹ thuật của Lumio**, không phải nguyên văn tài liệu. Các mã và tên field dùng ở đây đều đã xác nhận ở trên.

1. Trước khi bắt đầu: `GET /v2/Common/TerminalStatus` → chỉ chạy khi `TerminalStatus === "Online"`.
2. Sinh `ReferenceId` **duy nhất, ≤ 50 ký tự, alphanumeric**, lưu DB trước khi gọi Sale. Đây chính là idempotency key tự nhiên (SPIn từ chối trùng bằng mã `1011`).
3. Gọi `POST /v2/Payment/Sale` với HTTP timeout > `SPInProxyTimeout` (hoặc > 120s nếu để null).
4. Nếu request bị timeout / lỗi mạng / trả `StatusCode = 2007`:
   - **KHÔNG gọi lại Sale.**
   - Gọi `POST /v2/Payment/Status` với **cùng `ReferenceId`** và cùng `PaymentType`.
   - `StatusCode = "0000"` ⇒ đã charge thành công, ghi nhận `AuthCode`, `BatchNumber`, `TransactionNumber`, `RRN`, `PNReferenceId`, `CardData`.
   - `StatusCode = "1001"` hoặc `"2009"` ⇒ chưa có giao dịch, được phép thử lại (nên dùng `ReferenceId` mới hoặc retry cùng ReferenceId — xem CHƯA CHẮC CHẮN).
5. Nếu Sale trả `StatusCode = "1011"` (Duplicate Reference ID) ⇒ giao dịch với ReferenceId đó **đã tồn tại trong batch** → gọi Status để lấy kết quả, tuyệt đối không tạo lệnh mới.
6. Nếu `StatusCode = "2008"` (Terminal in use) ⇒ chờ `GeneralResponse.DelayBeforeNextRequest` **giây** rồi thử lại.
7. Cần huỷ lệnh đang chạy trên máy: `POST /v2/Payment/AbortTransaction` với cùng `ReferenceId`.
8. Lưu vào DB tối thiểu: `ReferenceId`, `InvoiceNumber`, `AuthCode`, `BatchNumber`, `TransactionNumber`, `RRN`, `PNReferenceId`, `SerialNumber`, `Amounts.*`, `CardData.CardType/Last4/First4/EntryType`, `GeneralResponse.*` — để sau này Void/đối soát.

---

## CHƯA CHẮC CHẮN

Những điểm dưới đây **KHÔNG đọc được** hoặc còn nghi ngờ. Đừng code dựa trên phỏng đoán ở các mục này.

1. **Header `Content-Type`** — ví dụ cURL trong doc chỉ có `curl --location '<url>' --data '{...}'`, **không hiển thị `--header 'Content-Type: application/json'`**. Với curl, `--data` mặc định gửi `application/x-www-form-urlencoded`. Không rõ server có tự nhận JSON hay không. **Cần test thực tế**; khả năng cao vẫn phải gửi `Content-Type: application/json`.

2. **Đơn vị của `SPInProxyTimeout`** — doc chỉ ghi min 1 / max 720, **không ghi đơn vị**. Suy đoán là giây (720s = 12 phút, khớp với default 120s / settlement 420s) nhưng **doc không xác nhận**.

3. **Timestamp giao dịch** — schema Sale/Void/Return/Status **không có** field thời gian ở cấp root. Không rõ lấy thời gian giao dịch ở đâu (có thể nằm trong `ExtendedDataByApplication` tuỳ processor, hoặc phải tự lưu). `StatusDateTime` chỉ có ở `GET /v2/IntermediateStatus/GetStatus`.

4. **`Cart.Items[]`** — mới đọc được cấu trúc từ JSON mẫu (`Name`, `Price`, `UnitPrice`, `Quantity`, `AdditionalInfo`, `CustomInfos[]{Name,Value}`, `Modifiers[]{Name,Options[]{Name,Price,Quantity}}`). **Chưa mở bảng field chi tiết** (kiểu dữ liệu, required, ràng buộc) của `Cart.Amounts[]`, `Cart.CashPrices[]`, `Cart.Items[]`.

5. **Mô tả bị cắt trong tài liệu** (chính doc hiển thị dấu "..."):
   - Void: "Void operation cancels operation that it is referring to. Void need to do before Settlement. You can..." — phần sau không hiển thị.
   - `IPosToken`: "...POS can perform new authorisation using \"Transact\" api o..." — bị cắt.
   - `request.tpn` (TerminalStatus): "...Required if..." — bị cắt.
   - Mục `2xxx` trên trang Error Codes: "...terminal did no..." — bị cắt.

6. **`/v2/Payment/Status` không có mô tả** — trang Status trong doc để trống hoàn toàn phần văn bản. Cách diễn giải kết quả ở mục 8 là **suy luận** từ bảng mã lỗi (`1001` "Status request could not find a matching transaction record"), không phải doc nói trực tiếp.

7. **Retry sau khi Status trả 1001/2009** — doc không nói có được dùng lại cùng `ReferenceId` hay không. An toàn nhất: sinh `ReferenceId` mới cho lần thử lại và lưu link tới lần trước.

8. **`SPInToken`** — mô tả của `Authkey` nói "Required if no SPInToken", nhưng **không có field `SPInToken`** trong bất kỳ danh sách body parameters nào đã đọc. Không rõ cơ chế token thay thế Authkey được truyền như thế nào (có thể qua header?). **Chưa đọc được.**

9. **Chưa đọc chi tiết** các endpoint: `TipAdjust`, `Auth`, `Capture`, `Settle`, `OfflineStatus`, `Report/Summary`, `Report/Daily`, `Common/Printer`, `Common/GetSignature`, `UserChoice`, `UserInput`, `Disclaimer`, `TableApp/*`, `Payment/Cart`, `Payment/GetCard`, `Payment/Balance`, toàn bộ nhóm `Gift`, `L2L3`, `CEDP`, `AutoRental`, `Post Callback`, `Callback Get Last Callback`, `Capture CEDP`, `Upload Transaction`, `Post Intermediate Status`. Cũng chưa đọc trang "Extended Data for Responses" và trang "Signature".

10. **Cách lấy `Tpn` + `Authkey`** — không có trong tài liệu API này; phải lấy từ portal iPOSpays của merchant.

11. **`ExtendedDataByApplication`** — schema ghi lúc là `object`, lúc là `array` (khác nhau giữa các tab response mẫu). Trong JSON mẫu DvPay nó là **object** với key là tên card brand (ví dụ `"Mastercard"`). Nội dung bên trong **thay đổi theo processor** — không nên phụ thuộc vào các field bên trong.

12. **Min/max length của các field trong Return / Void / Status** — đã đọc qua accessibility tree nên hiển thị nhãn "Min length"/"Max length" mà không kèm số. Tôi chỉ xác nhận số bằng screenshot ở phần **Sale**; giả định các endpoint khác dùng cùng ràng buộc (`ReferenceId` 1–50, `Tpn` 10–12, `Authkey` 10–10, `RegisterId` 2–50, `InvoiceNumber` max 50) — **chưa verify từng trang một**.

13. **Cách gọi `/v2/Common/TerminalStatus` có bắt buộc cả 3 query param không** — không param nào được đánh dấu Required trong doc, và mô tả bị cắt ở chỗ "Required if...". Suy đoán: cần (`request.tpn` HOẶC `request.registerId`) + `request.authkey`.
