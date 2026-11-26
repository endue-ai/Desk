import { BridgeClient, type BridgeEvent, browserStub, type PluginInfo } from "@endue-ai/bridge";
import { expect, it, vi } from "vitest";
import { PluginInstances } from "./instances";
import { Owners } from "./owners";
import { type EventRoutes, routeEvent } from "./plugins-events";

const IMAGES = "endue.images";
const OTHER_PANE = "endue.images@2";

function imageInvocation(window?: string): BridgeEvent {
  return {
    event: "cmd.invoked",
    data: {
      id: "endue.images.zoom",
      invocationId: "invocation-1",
      caller: "agent:eris",
      args: { level: "fit", ...(window === undefined ? {} : { window }) },
    },
  };
}

it("delivers an Images command to the explicit pane instead of the last used pane", () => {
  const instances = new PluginInstances();
  instances.add(IMAGES);
  instances.add(OTHER_PANE);
  instances.touch(IMAGES);
  const post = vi.fn();
  const refuse = vi.fn();
  const routes: EventRoutes = {
    bridge: new BridgeClient(browserStub({})),
    owners: new Owners(),
    instances,
    commands: { route: () => IMAGES, refuse } as unknown as EventRoutes["commands"],
    mounted: new Map([[IMAGES, { id: IMAGES, builtIn: true } as PluginInfo]]),
    post,
  };
  const targeted = imageInvocation(`plugin:${OTHER_PANE}`);
  routeEvent(targeted, routes);
  expect(post).toHaveBeenLastCalledWith(OTHER_PANE, { type: "desk:event", event: targeted });

  const implicit = imageInvocation();
  routeEvent(implicit, routes);
  expect(post).toHaveBeenLastCalledWith(IMAGES, { type: "desk:event", event: implicit });

  instances.delete(OTHER_PANE);
  routeEvent(targeted, routes);
  routeEvent(imageInvocation("plugin:endue.player"), routes);
  expect(post).toHaveBeenCalledTimes(2);
  expect(refuse).toHaveBeenCalledTimes(2);
});
