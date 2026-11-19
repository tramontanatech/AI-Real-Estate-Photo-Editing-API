// Types for the Stager AI REST API (https://stagerai.com/api-docs).

export type RoomType =
  | "LIVING_ROOM"
  | "DINING_ROOM"
  | "BEDROOM"
  | "KITCHEN"
  | "KITCHEN_LIVING_AREA"
  | "HOME_OFFICE"
  | "TERRACE"
  | "BALCONY"
  | "BATHROOM"
  | "EXTERIOR"
  | "GAME_ROOM"
  | "KIDS_ROOM"
  | "GARAGE"
  | "GYM"
  | "NURSERY"
  | "BASEMENT"
  | "BACKYARD"
  | "ENTRYWAY";

export type RoomStyle =
  | "modern"
  | "minimalist"
  | "scandinavian"
  | "industrial"
  | "rustic"
  | "farmhouse"
  | "kidsRoom"
  | "coastalModern"
  | "luxury"
  | "midCentury"
  | "bohoChic"
  | "japandi";

export type ColorType =
  | "classicWhite"
  | "charcoalGray"
  | "matteBlack"
  | "beige"
  | "espressoBrown"
  | "walnut"
  | "naturalWood"
  | "navyBlue"
  | "forestGreen"
  | "rusticOak"
  | "ivory"
  | "steelBlue"
  | "ashGray"
  | "mahogany";

/** 15 = Stager Luma (default), 13 = Stager Classic V2. */
export const EditingStyle = {
  Luma: 15,
  ClassicV2: 13,
} as const;
export type EditingStyle = (typeof EditingStyle)[keyof typeof EditingStyle];

export interface HdrOptions {
  lensCorrection?: boolean;
  perspectiveCorrection?: boolean;
  photographerRemoval?: boolean;
  fireplaceEnhancement?: boolean;
  tvScreenReplacement?: boolean;
  autoPrivacy?: boolean;
  blurLicensePlates?: boolean;
  /** On by default. Puts a blue sky in the windows. */
  skyReplacement?: boolean;
  /** Off by default. Replaces patchy grass on exterior photos. */
  lawnReplacement?: boolean;
  editingStyle?: EditingStyle | number;
  /** Your own id, echoed back in every status response and webhook. */
  clientReferenceId?: string;
}

export interface Project {
  id: string;
  title: string;
}

export interface PhotosQuota {
  photosQuota: number;
}

export type ReplacementOutcome = "applied" | "skipped" | "failed";

/** Numeric HDR error codes. See https://stagerai.com/api-docs#error-codes */
export const HdrErrorCode = {
  NoCredits: 1,
  MergeFailed: 2,
  EditsFailed: 3,
  StyleFailed: 4,
  Timeout: 5,
  NoImages: 6,
  ConversionFailed: 7,
  MaxRetries: 8,
  GenerationFailed: 9,
  TooManyImages: 10,
  AlignmentFailed: 11,
} as const;

export interface HdrGroupStatus {
  status: "processing" | "completed" | "error";
  imageUrl?: string;
  originalImageUrl?: string;
  filename?: string;
  clientReferenceId?: string;
  lawnReplacement?: ReplacementOutcome;
  tvLogo?: ReplacementOutcome;
  code?: number;
  message?: string;
  errorMessage?: string;
}

export interface HdrBatchResult {
  groupId: string;
  imageUrl?: string;
  originalImageUrl?: string;
  filename?: string;
  processing?: boolean;
  status?: "error";
  code?: number;
  message?: string;
  errorMessage?: string;
  lawnReplacement?: ReplacementOutcome;
}

export interface HdrBatchStatus {
  processing: boolean;
  status?: "processing" | "completed" | "error";
  message?: string;
  clientReferenceId?: string;
  results: HdrBatchResult[];
}

export interface UploadUrl {
  id: string;
  url: string;
}

export interface TvScreenImage {
  id: string;
  name: string;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

export interface UploadedImage {
  id: string;
  imageUrl: string;
  width: number;
  height: number;
}

export type EditActionType =
  | "subtleStaging"
  | "autoStaging"
  | "renovation"
  | "lawnReplace"
  | "skyReplace"
  | "declutter"
  | (string & {});

export interface Generation {
  generationId: string;
  imageId: string;
  actionType: EditActionType;
  status: "processing" | "completed" | "failed";
  resultId?: string;
  imageUrl?: string;
  width?: number;
  height?: number;
}

export interface StageParams {
  roomType: RoomType;
  roomStyle: RoomStyle;
  actionType?: "subtleStaging" | "autoStaging";
  colorTypes?: ColorType[];
  removeFurniture?: boolean;
  extraInstructions?: string;
}

export interface RenovateParams {
  roomType: RoomType;
  roomStyle?: RoomStyle;
  colorTypes?: ColorType[];
  extraInstructions?: string;
}

export interface LawnReplaceParams {
  lawnType?: "light" | "medium" | "strong";
  extraInstructions?: string;
}

export interface SkyReplaceParams {
  skyType: "blue" | "twilight";
  /** Twilight only. */
  skySubType?: "subtle" | "middle" | "dramatic";
}

export interface DeclutterParams {
  extraInstructions?: string;
}

export interface AudioTrack {
  id: string;
  name: string;
  url: string;
  isCustom: boolean;
}

export const VideoEffect = {
  Default: 0,
  SlowMotionWalkthrough: 1,
  SlowMotionAerial: 2,
  FastSpeedRamps: 3,
  SplitScreen: 4,
  ExteriorToInterior: 5,
  StagingFurnitureAppears: 6,
  DawnToNoon: 7,
  DayToNight: 8,
  StarryNight: 9,
  SummerToWinter: 10,
  HouseLandsOnTerrain: 11,
  HouseBuildsUp: 12,
  Renovation: 13,
} as const;
export type VideoEffect = (typeof VideoEffect)[keyof typeof VideoEffect];

/** Only used with VideoEffect.SlowMotionWalkthrough. */
export const CameraMotion = {
  Default: 0,
  PushIn: 1,
  PushOut: 2,
  SlowMoDescending: 3,
  SlowMoElevating: 4,
  OrbitRight: 5,
  OrbitLeft: 6,
} as const;
export type CameraMotion = (typeof CameraMotion)[keyof typeof CameraMotion];

export interface CreateVideoParams {
  title?: string;
  orientation: "horizontal" | "vertical";
  audioId?: string;
}

export interface ClipImage {
  id: string;
  order: number;
}

export interface ClipParams {
  images: ClipImage[];
  customInstructions?: string;
  effect?: VideoEffect | number;
  cameraMotion?: CameraMotion | number;
}

export interface Video {
  id: string;
  title?: string;
  orientation?: "horizontal" | "vertical";
  videoType?: string;
  videoUrl: string | null;
  createdAt?: string;
  clips?: Array<{
    id: string;
    order: number;
    videoUrl?: string;
    images: Array<{ id: string; imageId: string; url: string; isGeneration: boolean }>;
  }>;
}

export type RenderProgress =
  | { status: "progress"; progress: number }
  | { status: "done"; url: string; size: number }
  | { status: "error"; message: string };

// ---- Webhooks ----

export interface WebhookEventBase<T extends string, D> {
  eventId: string;
  eventType: T;
  createdAt: string;
  data: D;
}

export type WebhookEvent =
  | WebhookEventBase<
      "hdr.image.completed",
      {
        groupId: string;
        clientReferenceId?: string;
        imageUrl: string;
        originalImageUrl: string;
        filename: string;
      }
    >
  | WebhookEventBase<
      "hdr.image.failed",
      { groupId: string; clientReferenceId?: string; errorCode: number; message: string }
    >
  | WebhookEventBase<
      "edit.completed",
      {
        generationId: string;
        imageId: string;
        actionType: EditActionType;
        resultId: string;
        imageUrl: string;
        width: number;
        height: number;
      }
    >
  | WebhookEventBase<
      "edit.failed",
      { generationId: string; imageId: string; actionType: EditActionType; message: string }
    >;
