import { API_URL, api } from "./client";

export type PdfAsset = {
  id: string;
  kind: "PDF";
  name: string;
  sizeBytes: number | null;
  pageCount: number;
};

export type AssetUsage = {
  usedBytes: number;
  limitBytes: number;
};

const assetPath = (drawingId: string, assetId: string) =>
  `/drawings/${encodeURIComponent(drawingId)}/assets/${encodeURIComponent(assetId)}`;

export const uploadPdfAsset = async (
  drawingId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<PdfAsset> => {
  const response = await api.post<PdfAsset>(
    `/drawings/${encodeURIComponent(drawingId)}/assets`,
    file,
    {
      params: { name: file.name },
      headers: { "Content-Type": "application/pdf" },
      onUploadProgress: (event) => {
        if (!event.total) return;
        onProgress?.(Math.min(100, Math.round((event.loaded * 100) / event.total)));
      },
    },
  );
  return response.data;
};

export const getPdfAsset = async (
  drawingId: string,
  assetId: string,
): Promise<PdfAsset> => {
  const response = await api.get<PdfAsset>(assetPath(drawingId, assetId));
  return response.data;
};

export const getAssetUsage = async (): Promise<AssetUsage> => {
  const response = await api.get<AssetUsage>("/assets/usage");
  return response.data;
};

const absoluteApiUrl = (path: string) =>
  `${API_URL.replace(/\/$/, "")}${path}`;

export const getPdfPageUrl = (
  drawingId: string,
  assetId: string,
  page: number,
) => absoluteApiUrl(`${assetPath(drawingId, assetId)}/pages/${page}`);

export const getPdfOriginalUrl = (drawingId: string, assetId: string) =>
  absoluteApiUrl(`${assetPath(drawingId, assetId)}/original`);
