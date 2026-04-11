import { model, Schema } from "mongoose";

const PhotoSchema = new Schema({
  fileId: Schema.Types.ObjectId,
  filename: String,
  contentType: String,
  username: String,
  uniqueID: String,
  views: Number,
});

const PhotoModel = model("mainDB", PhotoSchema);

export { PhotoModel };
