/**
 * Sidebar entry: the icon button that selects the birthday main panel.
 * `sidebar.panellist` resolves the visible label from the registration's
 * `label` metadata, so this component only supplies the mark itself.
 */

import * as React from 'react';

export function SidebarEntry(): React.ReactElement {
  return (
    <span className="dsh-birthday-sidebar-entry" title="生日" aria-label="生日">
      🎂
    </span>
  );
}
