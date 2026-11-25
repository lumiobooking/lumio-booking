/**
 * What the salon does to add a terminal, per provider, in plain words. Square
 * makes the code itself (Lumio shows it, the salon types it on the device), so
 * there is nothing to type here; the others show a code ON the device.
 */
export function readerHowTo(provider: string, vi: boolean): { needsCode: boolean; codeLabel: string; codePlaceholder: string; button: string; steps: string[] } {
  const add = vi ? 'Thêm máy' : 'Add reader';
  const codeLabel = vi ? 'Mã trên màn hình máy' : 'Code shown on the reader';
  switch (provider) {
    case 'clover_device':
      return { needsCode: true, codeLabel: vi ? 'Số serial máy Clover' : 'Clover device serial number', codePlaceholder: vi ? 'vd. C046UQ51057292' : 'e.g. C046UQ51057292', button: add, steps: vi ? [
        'Trên máy Clover (Flex / Mini / Compact): mở More Tools → tìm "Cloud Pay Display" → Connect (cài miễn phí). Mở Cloud Pay Display và bấm Start — để app chạy thì máy mới nhận lệnh từ Lumio.',
        'Số serial: trên máy vào Settings → About device, hoặc Clover Dashboard → Account & Setup → Devices. Gõ số đó vào ô bên dưới rồi bấm Thêm máy.',
        'Bấm "Kiểm tra máy": máy online là xong — từ giờ chọn máy này ở bước Thanh toán thẻ, số tiền (kèm tip) tự hiện trên máy Clover.',
      ] : [
        'On the Clover device (Flex / Mini / Compact): More Tools → search "Cloud Pay Display" → Connect (free). Open Cloud Pay Display and tap Start — it must be running for the device to take payments from Lumio.',
        'Serial number: on the device Settings → About device, or Clover Dashboard → Account & Setup → Devices. Type it below and press Add reader.',
        'Press "Test terminal": once online, pick this device at card checkout and the amount (with tip) appears on the Clover device.',
      ] };
    case 'helcim':
      return { needsCode: true, codeLabel, codePlaceholder: vi ? 'vd. A1B2' : 'e.g. A1B2', button: add, steps: vi ? [
        'Lần đầu: nhờ Helcim bật quyền API / chế độ Paired cho tài khoản (gọi hoặc gửi ticket cho Helcim).',
        'Trên máy Smart Terminal: bấm More → Log out → đăng nhập lại → bấm Switch sang "Paired".',
        'Máy hiện một mã riêng — gõ mã đó vào ô bên dưới rồi bấm Thêm máy.',
      ] : [
        'First time only: ask Helcim support to enable API / Paired mode on the account.',
        'On the Smart Terminal: More → Log out → sign in again → tap Switch to "Paired".',
        'The terminal shows its own code — type it below and press Add reader.',
      ] };
    case 'square':
      return { needsCode: false, codeLabel, codePlaceholder: '', button: vi ? 'Tạo mã ghép' : 'Create pairing code', steps: vi ? [
        'Bấm "Tạo mã ghép" — mã hiện trong danh sách máy ở trên (dùng được 5 phút).',
        'Trên máy Square Terminal: đăng xuất → ở màn hình đăng nhập chọn đăng nhập bằng mã thiết bị (device code) → gõ mã đó.',
        'Bấm Làm mới — máy hiện "ONLINE" là xong.',
      ] : [
        'Press "Create pairing code" — the code appears in the reader list above (valid 5 minutes).',
        'On the Square Terminal: sign out → on the sign-in screen choose sign in with a device code → type the code.',
        'Press Refresh — the reader shows ONLINE when done.',
      ] };
    case 'stripe':
      return { needsCode: true, codeLabel, codePlaceholder: vi ? 'vd. sepia-cerulean-aqua' : 'e.g. sepia-cerulean-aqua', button: add, steps: vi ? [
        'Trên máy Stripe: mở Settings → Generate pairing code (tạo mã ghép).',
        'Gõ mã máy hiện vào ô bên dưới rồi bấm Thêm máy.',
      ] : [
        'On the Stripe reader: Settings → Generate pairing code.',
        'Type the code it shows below and press Add reader.',
      ] };
    case 'dejavoo':
      return { needsCode: true, codeLabel: 'TPN', codePlaceholder: vi ? 'TPN 12 số' : '12-digit TPN', button: add, steps: vi ? [
        'Gõ TPN của máy (in trên nhãn máy hoặc trong iPOSpays → Terminals).',
        'Máy ở chi nhánh khác có Auth Key riêng thì dán vào ô Auth Key.',
      ] : [
        "Type the terminal's TPN (on its label or in iPOSpays → Terminals).",
        'A terminal at another location with its own Auth Key: paste it in Auth Key.',
      ] };
    case 'adyen':
      return { needsCode: true, codeLabel: vi ? 'POI / device id' : 'POI / device id', codePlaceholder: 'S1F2-000158…', button: add, steps: vi ? [
        'Gõ POI / device id của máy (Adyen Customer Area → Terminals).',
      ] : [
        "Type the terminal's POI / device id (Adyen Customer Area → Terminals).",
      ] };
    default:
      return { needsCode: true, codeLabel, codePlaceholder: '', button: add, steps: vi ? [
        'Mở phần ghép thiết bị trên máy để hiện mã ghép.',
        'Gõ mã đó vào ô bên dưới rồi bấm Thêm máy.',
      ] : [
        "Open the reader's pairing screen to show its pairing code.",
        'Type that code below and press Add reader.',
      ] };
  }
}
