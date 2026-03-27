import path from "node:path";
import {
  AutojoinRoomsMixin,
  MatrixAuth,
  MatrixClient,
  RustSdkCryptoStorageProvider,
  SimpleFsStorageProvider,
} from "matrix-bot-sdk";
import { logger } from "./logger.js";

export interface MatrixClientConfig {
  homeserverUrl: string;
  accessToken?: string;
  userId?: string;
  password?: string;
  deviceId?: string;
  enableEncryption?: boolean;
  autoJoinRooms?: boolean;
  storageDir?: string;
}

/**
 * Create and configure a MatrixClient with optional E2EE support.
 *
 * Login flow:
 * 1. If accessToken is provided, use it directly
 * 2. If userId + password are provided, perform password login to get an access token
 */
export async function createMatrixClient(config: MatrixClientConfig): Promise<MatrixClient> {
  if (!config.storageDir) {
    throw new Error("Matrix plugin requires storageDir to be set — E2EE keys must not be stored in /tmp");
  }
  const storageDir = config.storageDir;

  let accessToken = config.accessToken;

  if (!accessToken) {
    if (!config.userId || !config.password) {
      throw new Error("Matrix plugin requires either accessToken or userId+password");
    }
    logger.info({ msg: "Logging in with password", userId: config.userId });
    const auth = new MatrixAuth(config.homeserverUrl);
    const loginClient = await auth.passwordLogin(config.userId, config.password);
    accessToken = loginClient.accessToken;
    logger.info({ msg: "Password login successful, got access token" });
  }

  const storageProvider = new SimpleFsStorageProvider(path.join(storageDir, "matrix-bot-storage.json"));

  let cryptoProvider: RustSdkCryptoStorageProvider | undefined;
  if (config.enableEncryption !== false) {
    cryptoProvider = new RustSdkCryptoStorageProvider(path.join(storageDir, "crypto"));
    logger.info({ msg: "E2EE crypto storage initialized", path: path.join(storageDir, "crypto") });
  }

  const client = new MatrixClient(config.homeserverUrl, accessToken, storageProvider, cryptoProvider);

  if (config.autoJoinRooms !== false) {
    AutojoinRoomsMixin.setupOnClient(client);
    logger.info({ msg: "AutojoinRoomsMixin enabled" });
  }

  return client;
}
