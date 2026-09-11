import type { ReactNode } from "react";
import { ScreenTitle } from "./ScreenTitle.js";

/**
 * One screen, in the approved layout.
 *
 * Every destination is a 58px topbar and a scrolling body with the same gutters. Screens that did
 * not use it were laid out as bare flex columns inside `.product-view`, which supplies neither
 * padding nor a scroll container — so their content sat flush against the sidebar and ran off the
 * right-hand edge. Search, the audit history and the client file all did exactly that.
 *
 * `page-body` carries `min-width: 0`, which is the part that actually stops the overflow: a grid
 * column of `1fr` is `minmax(auto, 1fr)`, so without it any wide child — a long table, an
 * unbreakable policy number — pushes the whole shell sideways rather than scrolling inside it.
 *
 * Use this for every screen. A screen with its own full-bleed layout (Ask's two-column workspace)
 * passes `bare` and takes responsibility for its own body.
 */
export function Page({
  title,
  meta,
  actions,
  crumbs,
  children,
  bare = false,
}: {
  title: string;
  meta?: string;
  actions?: ReactNode;
  crumbs?: string[];
  children: ReactNode;
  bare?: boolean;
}) {
  return (
    <>
      <ScreenTitle
        title={title}
        {...(meta === undefined ? {} : { meta })}
        {...(actions === undefined ? {} : { actions })}
        {...(crumbs === undefined ? {} : { crumbs })}
      />
      {bare ? children : <section className="page-scroll page-body">{children}</section>}
    </>
  );
}
