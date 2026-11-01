import { findAmounts } from './image-amount.js';

let scanId = 0;
export function resetImageAmount() {
  scanId++;
  document.querySelector('#image-amount-status').textContent = '';
  document.querySelector('#image-amount-results').replaceChildren();
}

export function setupImageAmount() {
  const status = document.querySelector('#image-amount-status');
  const results = document.querySelector('#image-amount-results');
  const amountInput = document.querySelector('#transaction-amount');
  document.querySelectorAll('[data-image-input]').forEach((input) => input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    const current = ++scanId;
    results.replaceChildren();
    if (!file.type.startsWith('image/')) { status.textContent = 'Vui lòng chọn tệp ảnh.'; return; }
    if (file.size > 20 * 1024 * 1024) { status.textContent = 'Ảnh quá lớn. Vui lòng chọn ảnh dưới 20 MB.'; return; }
    status.textContent = 'Đang đọc ảnh trên thiết bị…';
    let worker;
    try {
      const { default: { createWorker } } = await import('./vendor/ocr/tesseract.esm.min.js');
      worker = await createWorker('vie', 1, {
        workerPath: new URL('./vendor/ocr/worker.min.js', import.meta.url).href,
        corePath: new URL('./vendor/ocr', import.meta.url).href,
        langPath: new URL('./vendor/ocr', import.meta.url).href,
      });
      if (current !== scanId) return;
      const { data } = await worker.recognize(file);
      if (current !== scanId) return;
      const amounts = findAmounts(data.text);
      status.textContent = amounts.length ? 'Chọn số tiền tìm thấy trong ảnh, rồi kiểm tra trước khi lưu:' : 'Không tìm thấy số tiền. Hãy thử ảnh rõ hơn hoặc nhập thủ công.';
      for (const amount of amounts) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button button-outline';
        button.textContent = `${amount.toLocaleString('vi-VN')} ₫`;
        button.addEventListener('click', () => {
          amountInput.value = amount.toLocaleString('vi-VN');
          status.textContent = 'Đã điền số tiền. Vui lòng kiểm tra trước khi lưu.';
          amountInput.focus();
        });
        results.append(button);
      }
    } catch (error) {
      if (current === scanId) status.textContent = 'Không đọc được ảnh. Hãy thử ảnh khác hoặc nhập thủ công.';
      console.error('Image OCR failed', error);
    } finally {
      if (worker) await worker.terminate();
    }
  }));
  document.querySelector('#transaction-dialog').addEventListener('close', resetImageAmount);
}

