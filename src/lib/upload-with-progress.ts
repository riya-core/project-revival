// Uploads a file to private storage while reporting progress (the storage SDK has no
// progress callback). Runs in the browser only, with the signed-in user's own token,
// so storage rules still decide what the user may write.

export type UploadResult = { ok: true } | { ok: false; error: string };

export function uploadWithProgress(options: {
  bucket: string;
  path: string;
  file: File;
  accessToken: string;
  onProgress: (percent: number) => void;
}): Promise<UploadResult> {
  const baseUrl = String(import.meta.env["VITE_SUPABASE_URL"] ?? "").replace(/\/+$/, "");
  const apiKey = String(import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "");
  const encodedPath = options.path.split("/").map(encodeURIComponent).join("/");

  return new Promise((resolve) => {
    if (!baseUrl || !apiKey) {
      resolve({ ok: false, error: "Image storage is not configured." });
      return;
    }
    const request = new XMLHttpRequest();
    request.open("POST", `${baseUrl}/storage/v1/object/${options.bucket}/${encodedPath}`);
    request.setRequestHeader("Authorization", `Bearer ${options.accessToken}`);
    request.setRequestHeader("apikey", apiKey);
    request.setRequestHeader("x-upsert", "true");
    request.setRequestHeader("cache-control", "3600");
    request.setRequestHeader("Content-Type", options.file.type || "image/jpeg");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options.onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        options.onProgress(100);
        resolve({ ok: true });
        return;
      }
      resolve({
        ok: false,
        error:
          request.status === 413
            ? "This image is larger than storage allows."
            : request.status === 401 || request.status === 403
              ? "Your session has expired. Please log in again."
              : "The image could not be uploaded. Please try again.",
      });
    };
    request.onerror = () => resolve({ ok: false, error: "Cannot reach image storage. Check your connection." });
    request.onabort = () => resolve({ ok: false, error: "The upload was cancelled." });
    request.send(options.file);
  });
}
