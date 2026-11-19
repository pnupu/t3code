import { T, useMessages } from "gt-react";
import {
  getClientSettings,
  updateClientSettings,
  useClientSettings,
} from "../../hooks/useSettings";
import {
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "../ui/menu";
import {
  isDefaultThreadDetailsVisibility,
  resolveThreadDetailsVisibility,
  RESET_THREAD_DETAILS_ITEMS,
  setThreadDetailsItem,
  THREAD_DETAILS_ITEMS,
} from "./threadDetailsItems";

/** Menu body that shows and hides thread details items. The card's context menu and Settings share it. */
export function ThreadDetailsItemsMenuItems() {
  const visibility = useClientSettings(resolveThreadDetailsVisibility);
  const m = useMessages();
  const weeklyUsageStyle = useClientSettings((settings) => settings.threadDetailsWeeklyUsageStyle);
  return (
    <>
      <MenuGroup>
        <MenuGroupLabel>
          <T>Show in thread details</T>
        </MenuGroupLabel>
        {THREAD_DETAILS_ITEMS.map((item) => (
          <MenuCheckboxItem
            key={item.id}
            checked={visibility[item.id]}
            onCheckedChange={(checked) =>
              updateClientSettings({
                threadDetailsItems: setThreadDetailsItem(getClientSettings(), item, checked),
              })
            }
          >
            {m(item.label)}
          </MenuCheckboxItem>
        ))}
      </MenuGroup>
      <MenuSeparator />
      <MenuSub>
        <MenuSubTrigger>Weekly usage style</MenuSubTrigger>
        <MenuSubPopup>
          <MenuRadioGroup
            value={weeklyUsageStyle}
            onValueChange={(value) => {
              if (value === "lines" || value === "rings")
                updateClientSettings({ threadDetailsWeeklyUsageStyle: value });
            }}
          >
            <MenuRadioItem value="lines">Lines</MenuRadioItem>
            <MenuRadioItem value="rings">Rings</MenuRadioItem>
          </MenuRadioGroup>
        </MenuSubPopup>
      </MenuSub>
      <MenuItem
        disabled={isDefaultThreadDetailsVisibility(visibility)}
        onClick={() => updateClientSettings(RESET_THREAD_DETAILS_ITEMS)}
      >
        <T>Reset to default</T>
      </MenuItem>
    </>
  );
}
