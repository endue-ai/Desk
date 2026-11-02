// examples/plugin-hello-theme keeps its test beside it, as the built-in themes do, and that test is the
// one the theme template writes (theme.test.ts checks they match). The root vitest config takes tests
// from packages, apps and plugins only, so the example's suite runs from here.
import "../../../examples/plugin-hello-theme/tests/theme.test";
