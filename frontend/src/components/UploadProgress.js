import { Loader2, CheckCircle, Upload } from 'lucide-react';

export function UploadProgress({ phase, percent }) {
  if (phase === 'idle') return null;

  return (
    <div data-testid="upload-progress" className="mt-3 rounded-sm border border-slate-200 bg-white p-3 space-y-2">
      <div className="flex items-center gap-2">
        {phase === 'uploading' && <Upload className="w-4 h-4 text-sky-500 animate-pulse" />}
        {phase === 'processing' && <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />}
        {phase === 'done' && <CheckCircle className="w-4 h-4 text-emerald-500" />}
        <span className="text-[12px] font-body font-medium text-slate-700">
          {phase === 'uploading' && `Uploading file... ${percent}%`}
          {phase === 'processing' && 'Processing on server...'}
          {phase === 'done' && 'Upload complete!'}
        </span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
        <div
          data-testid="upload-progress-bar"
          className={`h-full rounded-full transition-all duration-300 ease-out ${
            phase === 'done' ? 'bg-emerald-500' : phase === 'processing' ? 'bg-amber-400 animate-pulse' : 'bg-sky-500'
          }`}
          style={{ width: `${phase === 'processing' ? 100 : phase === 'done' ? 100 : percent}%` }}
        />
      </div>
      {phase === 'processing' && (
        <p className="text-[10px] text-slate-400 font-body">Parsing Excel rows and saving to database. Large files may take a moment.</p>
      )}
    </div>
  );
}
