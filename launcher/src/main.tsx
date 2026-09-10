import { render } from "preact";
import App from "./App.tsx";

import "./styles/reset.css";
import "./styles/tokens.css";
import "./styles/ui.css";

render(<App />, document.getElementById("root")!);
