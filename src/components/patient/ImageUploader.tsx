import { useEffect, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/common/ui";
import { BLUR_THRESHOLD, validateImageFile } from "@/lib/skin-analysis";

export function ImageUploader({
  onAnalyze,
  onImageSelected,
  analyzing,
  analysisAttempted,
  hasPrediction,
}: {
  onAnalyze: (file: File) => void;
  onImageSelected: (file: File | null, previewUrl: string | null) => void;
  analyzing: boolean;
  analysisAttempted: boolean;
  hasPrediction: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [qualityWarning, setQualityWarning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const validationId = useRef(0);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const isLowQuality = (image: HTMLImageElement): boolean => {
    const { naturalWidth: width, naturalHeight: height } = image;
    if (Math.min(width, height) < 224) return true;

    const scale = Math.min(1, 512 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return true;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const gray = new Float32Array(canvas.width * canvas.height);
    for (let i = 0; i < gray.length; i += 1) {
      const offset = i * 4;
      gray[i] =
        0.299 * (pixels[offset] ?? 0) +
        0.587 * (pixels[offset + 1] ?? 0) +
        0.114 * (pixels[offset + 2] ?? 0);
    }

    let sum = 0;
    let sumSquares = 0;
    let count = 0;
    for (let y = 1; y < canvas.height - 1; y += 1) {
      for (let x = 1; x < canvas.width - 1; x += 1) {
        const index = y * canvas.width + x;
        const laplacian =
          (gray[index - 1] ?? 0) +
          (gray[index + 1] ?? 0) +
          (gray[index - canvas.width] ?? 0) +
          (gray[index + canvas.width] ?? 0) -
          4 * (gray[index] ?? 0);
        sum += laplacian;
        sumSquares += laplacian * laplacian;
        count += 1;
      }
    }
    if (count === 0) return true;
    const variance = sumSquares / count - (sum / count) ** 2;
    return variance < BLUR_THRESHOLD;
  };

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    validationId.current += 1;
    const validation = validationId.current;
    onImageSelected(null, null);
    setSelectedFile(null);
    setPreview(null);
    setFileName("");
    setQualityWarning(false);
    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    const previewUrl = URL.createObjectURL(file);
    const image = new Image();
    image.src = previewUrl;
    try {
      await image.decode();
      if (validation !== validationId.current) {
        URL.revokeObjectURL(previewUrl);
        return;
      }
      const lowQuality = isLowQuality(image);
      setSelectedFile(file);
      setFileName(file.name);
      setPreview(previewUrl);
      setQualityWarning(lowQuality);
      onImageSelected(file, previewUrl);
    } catch {
      URL.revokeObjectURL(previewUrl);
      if (validation !== validationId.current) return;
      setError("This image file is corrupted or unreadable.");
    }
  };

  const clear = () => {
    validationId.current += 1;
    onImageSelected(null, null);
    setSelectedFile(null);
    setPreview(null);
    setFileName("");
    setError(null);
    setQualityWarning(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <div className="text-sm font-semibold">New scan</div>
      <p className="mt-1 text-xs text-mute">Upload a clear, well-lit photo of the affected area.</p>

      {preview ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-line">
          <img
            src={preview}
            alt="Uploaded skin preview"
            data-testid="input-preview"
            className="aspect-[16/10] w-full object-cover"
          />
          <div className="flex items-center justify-between gap-2 bg-canvas2 px-3 py-2">
            <span className="truncate text-xs text-inksoft">{fileName}</span>
            <Button variant="ghost" onClick={clear} disabled={analyzing} className="px-2 py-1 text-xs text-riskink">
              Remove
            </Button>
          </div>
          <p className="border-t border-line bg-surface px-3 py-2 text-[11px] text-mute">
            Model input: 224 x 224, normalised
          </p>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => inputRef.current?.click()}
          className={`mt-3 grid cursor-pointer place-items-center rounded-xl border border-dashed px-4 py-8 text-center transition-colors ${
            dragging ? "border-brand bg-brand/5" : "border-line bg-canvas2"
          }`}
        >
          <div className="grid size-10 place-items-center rounded-full bg-surface ring-1 ring-line">
            <UploadCloud className="size-4 text-brand" />
          </div>
          <div className="mt-3 text-sm font-medium">Drop image or browse</div>
          <div className="mt-1 text-xs text-mute">JPG, JPEG or PNG · maximum 10 MB</div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png"
        data-testid="upload-input"
        className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {error ? (
        <div data-testid="upload-error" role="alert" className="mt-2 text-xs font-medium text-riskink">
          {error}
        </div>
      ) : null}
      {qualityWarning ? (
        <div data-testid="quality-warning" role="status" className="mt-2 text-xs font-medium text-cautionink">
          Low image quality: results may be unreliable
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          data-testid="analyse-btn"
          disabled={!selectedFile || analyzing || analysisAttempted}
          onClick={() => selectedFile && onAnalyze(selectedFile)}
        >
          {analyzing ? "Analysing…" : hasPrediction ? "Analysis complete" : analysisAttempted ? "Analysis attempted" : "Analyze image"}
        </Button>
        {preview ? (
          <Button variant="secondary" onClick={clear} disabled={analyzing}>
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
