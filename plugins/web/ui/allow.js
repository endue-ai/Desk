// The sanitizer's allowlists (ADR 0044). Anything not named here is dropped: an element not listed
// keeps only its children, an attribute not listed is gone. DROP lists the elements that go with
// everything inside them.

const set = (/** @type {string} */ words) => new Set(words.trim().split(/\s+/));

export const HTML_NS = "http://www.w3.org/1999/xhtml";
export const SVG_NS = "http://www.w3.org/2000/svg";
export const MATHML_NS = "http://www.w3.org/1998/Math/MathML";
export const XLINK_NS = "http://www.w3.org/1999/xlink";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** Elements removed with their contents, in any namespace (compared in lower case). */
export const DROP = set(`
  script noscript template iframe frame object embed applet param base meta link style title head
  noframes noembed portal fencedframe audio source track foreignobject annotation-xml annotation
  animate animatemotion animatetransform set discard mpath feimage handler listener metadata
  cursor view
`);

/** HTML elements kept as they are. */
export const HTML = set(`
  a abbr acronym address area article aside b bdi bdo big blockquote br button caption center cite
  code col colgroup data datalist dd del details dfn dialog dir div dl dt em fieldset figcaption
  figure font footer form h1 h2 h3 h4 h5 h6 header hgroup hr i img input ins kbd label legend li
  main map mark menu meter nav nobr ol optgroup option output p picture pre progress q rp rt rtc
  ruby s samp search section select small span strike strong sub summary sup table tbody td
  textarea tfoot th thead time tr tt u ul var video wbr
`);

/** HTML elements drawn as another: old raw-text elements as <pre>. */
export const RENAME = /** @type {Record<string, string>} */ ({
  xmp: "pre",
  listing: "pre",
  plaintext: "pre",
});

/** Attributes every HTML element may keep (aria-* and data-* too). */
export const GLOBAL = set("id class title lang dir hidden role translate style tabindex");

/** Attributes per HTML element. URLs among them go through the policy. */
export const HTML_ATTRS = /** @type {Record<string, Set<string>>} */ ({
  a: set("href name hreflang type"),
  area: set("href alt shape coords"),
  img: set("src alt width height usemap ismap align border hspace vspace decoding"),
  table: set(
    "border cellpadding cellspacing width height align bgcolor summary frame rules background",
  ),
  caption: set("align"),
  col: set("span width align valign"),
  colgroup: set("span width align valign"),
  tbody: set("align valign bgcolor"),
  thead: set("align valign bgcolor"),
  tfoot: set("align valign bgcolor"),
  tr: set("align valign bgcolor height"),
  td: set(
    "colspan rowspan headers scope abbr align valign width height bgcolor nowrap axis background",
  ),
  th: set(
    "colspan rowspan headers scope abbr align valign width height bgcolor nowrap axis background",
  ),
  ol: set("start reversed type compact"),
  ul: set("type compact"),
  li: set("value type"),
  dl: set("compact"),
  del: set("datetime"),
  ins: set("datetime"),
  time: set("datetime"),
  data: set("value"),
  font: set("color face size"),
  p: set("align"),
  div: set("align"),
  h1: set("align"),
  h2: set("align"),
  h3: set("align"),
  h4: set("align"),
  h5: set("align"),
  h6: set("align"),
  legend: set("align"),
  hr: set("align size width noshade color"),
  br: set("clear"),
  pre: set("width wrap"),
  details: set("open name"),
  dialog: set("open"),
  input: set(
    "type name value placeholder checked disabled readonly size maxlength minlength min max step multiple list pattern required alt width height src",
  ),
  button: set("type name value disabled"),
  select: set("name multiple size disabled required"),
  option: set("value selected disabled label"),
  optgroup: set("label disabled"),
  textarea: set("name rows cols placeholder readonly disabled wrap maxlength required"),
  label: set("for"),
  output: set("for name"),
  fieldset: set("disabled name"),
  form: set("name novalidate"),
  progress: set("value max"),
  meter: set("value min max low high optimum"),
  map: set("name"),
  video: set("width height poster"),
  bdo: set("dir"),
});

/** Input types a form may show; others (file) are dropped, image draws as its picture. */
export const INPUT_TYPES = set(`
  text search email url tel password number range date time datetime-local month week color
  checkbox radio submit reset button hidden image
`);

/** SVG elements that draw (names as the parser spells them). */
export const SVG = set(`
  svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath desc
  linearGradient radialGradient stop pattern clipPath mask marker image filter feBlend
  feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting
  feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR
  feGaussianBlur feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting
  feSpotLight feTile feTurbulence
`);

/** SVG attributes kept; href only as a #reference (or an image's data: URL). */
export const SVG_ATTRS = set(`
  id class style lang role href alignment-baseline baseline-shift clip clip-path clip-rule
  clipPathUnits color color-interpolation color-interpolation-filters color-rendering cx cy d dx
  dy direction display dominant-baseline fill fill-opacity fill-rule filter filterUnits
  flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style
  font-variant font-weight fr fx fy gradientTransform gradientUnits height in in2 k1 k2 k3 k4
  kerning letter-spacing lighting-color marker-end marker-mid marker-start markerHeight
  markerUnits markerWidth mask maskContentUnits maskUnits mode opacity operator order orient
  overflow paint-order pathLength patternContentUnits patternTransform patternUnits points
  preserveAspectRatio primitiveUnits r radius refX refY result rotate rx ry scale seed
  shape-rendering slope specularConstant specularExponent spreadMethod startOffset stdDeviation
  stitchTiles stop-color stop-opacity stroke stroke-dasharray stroke-dashoffset stroke-linecap
  stroke-linejoin stroke-miterlimit stroke-opacity stroke-width surfaceScale tableValues targetX
  targetY text-anchor text-decoration text-rendering textLength transform transform-origin type
  values vector-effect version viewBox visibility width word-spacing writing-mode x x1 x2
  xChannelSelector y y1 y2 yChannelSelector z amplitude exponent intercept azimuth elevation
  limitingConeAngle pointsAtX pointsAtY pointsAtZ kernelMatrix kernelUnitLength divisor bias
  edgeMode preserveAlpha baseFrequency numOctaves diffuseConstant lengthAdjust method spacing side
`);

/** MathML presentation elements; annotation-xml (HTML inside MathML) never. */
export const MATHML = set(`
  math mrow mi mn mo ms mtext mspace msub msup msubsup munder mover munderover mfrac msqrt mroot
  mstyle merror mpadded mphantom mfenced menclose mtable mtr mtd mlabeledtr mmultiscripts
  mprescripts none
`);

export const MATHML_ATTRS = set(`
  id class style dir display displaystyle mathvariant mathsize mathcolor mathbackground
  scriptlevel fence separator stretchy symmetric largeop movablelimits accent accentunder lspace
  rspace minsize maxsize linethickness columnalign rowalign columnspan rowspan columnlines
  rowlines frame width height depth voffset notation open close separators
`);
