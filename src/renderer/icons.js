import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Copy,
  CornerDownLeft,
  createIcons,
  History,
  Keyboard,
  Mic,
  Settings,
  Undo2,
  X
} from "../../node_modules/lucide/dist/esm/lucide.mjs";

const icons = {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Copy,
  CornerDownLeft,
  History,
  Keyboard,
  Mic,
  Settings,
  Undo2,
  X
};

export function renderIcons(root = document) {
  createIcons({
    root,
    icons,
    attrs: {
      width: "18",
      height: "18",
      "stroke-width": "1.8",
      "aria-hidden": "true"
    }
  });
}

renderIcons();
