// The part of the upload library's file object that we use. Defined here so nothing depends on a global type.
export type UploadedFileData = {
  originalname: string;
  buffer: Buffer;
  size: number;
};
