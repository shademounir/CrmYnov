import { publicOrigin } from "../browser-origin";
import { createLogout } from "./logout-handler";

export const POST: (request: Request) => Response = createLogout(publicOrigin);
