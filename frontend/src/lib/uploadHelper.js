import api from '../lib/api';
import { toast } from 'sonner';

const CHUNK_SIZE = 600000; // 600KB per chunk (safe under 1MB proxy limit)

/**
 * Universal file upload handler.
 * Small files (<800KB): direct multipart upload
 * Large files: split into base64 chunks, send sequentially, backend reassembles
 */
export async function uploadFile(url, formData, { onProgress, onDone, onError, timeout = 300000 } = {}) {
  const file = formData.get('file');
  const fileSize = file?.size || 0;

  // Small files: direct upload
  if (fileSize <= 800000) {
    try {
      const res = await api.post(url, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout,
        onUploadProgress: (evt) => {
          const pct = Math.round((evt.loaded * 100) / (evt.total || 1));
          if (onProgress) onProgress(pct >= 100 ? 'processing' : 'uploading', pct);
        },
      });
      if (onProgress) onProgress('done', 100);
      if (res.data?.background) toast.success(res.data.message || 'Processing in background.', { duration: 10000 });
      if (onDone) onDone(res.data);
      return res.data;
    } catch (err) {
      if (onProgress) onProgress('idle', 0);
      toast.error(err.response?.data?.detail || 'Upload failed');
      if (onError) onError(err.message);
      throw err;
    }
  }

  // Large files: chunked upload
  if (onProgress) onProgress('uploading', 5);

  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const totalChunks = Math.ceil(bytes.length / CHUNK_SIZE);
    const uploadType = url.includes('ho/upload') ? 'ho_stock' : url.includes('store/upload') ? 'store_stock' : url.includes('sales-upload') ? 'sales' : url.includes('purchase-upload') ? 'purchase' : url.includes('mode=new') ? 'products_new' : 'products';
    const storeMatch = url.match(/store_id=(\d+)/);
    const storeId = storeMatch ? parseInt(storeMatch[1]) : null;
    const uploadId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, bytes.length);
      const chunk = bytes.slice(start, end);
      // Convert binary to base64 without stack overflow
      let binary = '';
      const STEP = 8192;
      for (let j = 0; j < chunk.length; j += STEP) {
        binary += String.fromCharCode.apply(null, chunk.subarray(j, Math.min(j + STEP, chunk.length)));
      }
      const b64 = btoa(binary);

      const pct = Math.round(((i + 1) / totalChunks) * 80) + 10;
      if (onProgress) onProgress('uploading', pct);

      await api.post('/upload-chunk', {
        upload_id: uploadId,
        filename: file.name,
        chunk_index: i,
        total_chunks: totalChunks,
        chunk_data: b64,
        upload_type: uploadType,
        store_id: storeId,
      }, { timeout: 30000 });
    }

    if (onProgress) onProgress('done', 100);
    toast.success(`File uploaded (${totalChunks} parts). Processing in background. Refresh in 1-2 minutes.`, { duration: 12000 });
    if (onDone) onDone({ background: true, message: 'Processing in background' });
    return { background: true };
  } catch (err) {
    if (onProgress) onProgress('idle', 0);
    toast.error(err.response?.data?.detail || 'Chunk upload failed');
    if (onError) onError(err.message);
    throw err;
  }
}
