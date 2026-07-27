import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownLeft,
  createIcons,
  Globe2,
  History,
  House,
  Keyboard,
  MessageSquareText,
  Mic,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  Undo2,
  WandSparkles,
  X
} from "../../node_modules/lucide/dist/esm/lucide.mjs";

const icons = {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownLeft,
  Globe2,
  History,
  House,
  Keyboard,
  MessageSquareText,
  Mic,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  Undo2,
  WandSparkles,
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
