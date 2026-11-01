/* @ds-bundle: {"format":4,"namespace":"DesignSystem_94a3e6","components":[{"name":"ContractorCard","sourcePath":"components/cards/ContractorCard.jsx"},{"name":"ProjectCard","sourcePath":"components/cards/ProjectCard.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Explication","sourcePath":"components/drawings/Explication.jsx"},{"name":"RoomTag","sourcePath":"components/drawings/RoomTag.jsx"},{"name":"TitleBlock","sourcePath":"components/drawings/TitleBlock.jsx"},{"name":"Badge","sourcePath":"components/feedback/Badge.jsx"},{"name":"Rating","sourcePath":"components/feedback/Rating.jsx"},{"name":"StatusDot","sourcePath":"components/feedback/StatusDot.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Radio","sourcePath":"components/forms/Radio.jsx"},{"name":"RangeSlider","sourcePath":"components/forms/RangeSlider.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Breadcrumbs","sourcePath":"components/navigation/Breadcrumbs.jsx"},{"name":"Wordmark","sourcePath":"components/navigation/Header.jsx"},{"name":"Header","sourcePath":"components/navigation/Header.jsx"},{"name":"StepPath","sourcePath":"components/navigation/StepPath.jsx"}],"sourceHashes":{"components/cards/ContractorCard.jsx":"7668117a0965","components/cards/ProjectCard.jsx":"654c7fd81ad5","components/core/Button.jsx":"e5dd0ab1eaa8","components/core/Icon.jsx":"70e56eb1534f","components/core/IconButton.jsx":"569900065a8f","components/drawings/Explication.jsx":"6a329405b628","components/drawings/RoomTag.jsx":"76dd5a030e71","components/drawings/TitleBlock.jsx":"1493f6b6a5ff","components/feedback/Badge.jsx":"52ccc37da1e3","components/feedback/Rating.jsx":"19b33f85832b","components/feedback/StatusDot.jsx":"5891974c37c9","components/forms/Checkbox.jsx":"6cade1a42393","components/forms/Input.jsx":"ab19662af542","components/forms/Radio.jsx":"1a361b0ae724","components/forms/RangeSlider.jsx":"9dd768011913","components/forms/Select.jsx":"8d720d18e5c8","components/navigation/Breadcrumbs.jsx":"0565d741dfe3","components/navigation/Header.jsx":"c98e1895c746","components/navigation/StepPath.jsx":"28ff20edbfac","ui_kits/platform/Catalog.jsx":"c9b1f067159d","ui_kits/platform/ContractorPage.jsx":"96e0c1e9e58d","ui_kits/platform/Home.jsx":"7f4bfce2502c","ui_kits/platform/ProjectPage.jsx":"84adc75997db","ui_kits/platform/Shared.jsx":"6caa6a589a6e","ui_kits/platform/data.js":"cdca66a062c1"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DesignSystem_94a3e6 = window.DesignSystem_94a3e6 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const BASE = 'https://unpkg.com/lucide-static@0.460.0/icons/';
function Icon({
  name,
  size = 20,
  color = 'currentColor',
  style,
  ...rest
}) {
  const m = `url(${BASE}${name}.svg) center/contain no-repeat`;
  return /*#__PURE__*/React.createElement("span", _extends({
    "aria-hidden": "true"
  }, rest, {
    style: {
      display: 'inline-block',
      flex: 'none',
      width: size,
      height: size,
      background: color,
      WebkitMask: m,
      mask: m,
      ...style
    }
  }));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    h: 32,
    px: 14,
    fs: 13
  },
  md: {
    h: 40,
    px: 20,
    fs: 14
  },
  lg: {
    h: 48,
    px: 28,
    fs: 16
  }
};
function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  fullWidth = false,
  children,
  onClick,
  style,
  ...rest
}) {
  const [h, setH] = React.useState(false);
  const [p, setP] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
  const off = disabled || loading;
  const v = {
    primary: {
      background: p ? 'var(--action-primary-press)' : h ? 'var(--action-primary-hover)' : 'var(--action-primary)',
      color: '#fff',
      border: '1px solid transparent'
    },
    secondary: {
      background: h ? 'var(--ld-navy-50)' : '#fff',
      color: 'var(--ld-navy)',
      border: '1px solid var(--ld-navy)'
    },
    tertiary: {
      background: 'transparent',
      color: h ? 'var(--ld-navy)' : 'var(--ld-blue)',
      border: '1px solid transparent',
      paddingLeft: 4,
      paddingRight: 4
    }
  }[variant];
  const dis = disabled ? {
    background: 'var(--surface-disabled)',
    color: 'var(--ld-gray-400)',
    border: '1px solid transparent'
  } : {};
  const load = loading ? {
    background: '#fff',
    color: 'var(--ld-navy)',
    border: '1px solid var(--border-strong)'
  } : {};
  return /*#__PURE__*/React.createElement("button", _extends({}, rest, {
    disabled: off,
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => {
      setH(false);
      setP(false);
    },
    onMouseDown: () => setP(true),
    onMouseUp: () => setP(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: s.h,
      padding: `0 ${s.px}px`,
      borderRadius: 'var(--radius-sm)',
      font: `600 ${s.fs}px/1 var(--font-body)`,
      cursor: off ? 'default' : 'pointer',
      transition: 'background var(--dur-fast), color var(--dur-fast), transform var(--dur-fast)',
      transform: p && !off ? 'scale(.98)' : 'none',
      width: fullWidth ? '100%' : undefined,
      whiteSpace: 'nowrap',
      ...v,
      ...dis,
      ...load,
      ...style
    }
  }), loading && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 14,
      height: 14,
      borderRadius: '50%',
      border: '2px solid var(--ld-tech-gray)',
      borderTopColor: 'var(--ld-blue)',
      animation: 'ld-spin .8s linear infinite'
    }
  }), loading && /*#__PURE__*/React.createElement("style", null, '@keyframes ld-spin{to{transform:rotate(360deg)}}'), icon && !loading && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: s.fs + 3
  }), children, iconRight && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconRight,
    size: s.fs + 3
  }));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function IconButton({
  icon,
  size = 40,
  variant = 'outline',
  label,
  onClick,
  style,
  ...rest
}) {
  const [h, setH] = React.useState(false);
  const v = variant === 'ghost' ? {
    background: h ? 'var(--surface-soft)' : 'transparent',
    border: '1px solid transparent',
    color: 'var(--ld-graphite)'
  } : {
    background: h ? 'var(--ld-navy-50)' : '#fff',
    border: '1px solid var(--border-default)',
    color: 'var(--ld-navy)'
  };
  return /*#__PURE__*/React.createElement("button", _extends({}, rest, {
    "aria-label": label,
    title: label,
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      width: size,
      height: size,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      padding: 0,
      transition: 'background var(--dur-fast)',
      ...v,
      ...style
    }
  }), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: Math.round(size * 0.45)
  }));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/drawings/Explication.jsx
try { (() => {
const fmt = n => typeof n === 'number' ? n.toFixed(1).replace('.', ',') : n;
function Explication({
  title = 'Экспликация помещений',
  groups = [],
  total,
  variant = 'panel',
  style
}) {
  const sum = total ?? groups.reduce((s, g) => s + g.rooms.reduce((a, r) => a + (+r.area || 0), 0), 0);
  const panel = variant === 'panel';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: '#fff',
      border: '1px solid var(--border-default)',
      borderRadius: panel ? 'var(--radius-md)' : 0,
      boxShadow: panel ? 'var(--shadow-card)' : 'none',
      padding: '14px 16px 12px',
      minWidth: 240,
      boxSizing: 'border-box',
      font: '400 13px/1.3 var(--font-body)',
      color: 'var(--text-primary)',
      fontVariantNumeric: 'tabular-nums',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '700 15px var(--font-display)',
      color: 'var(--text-heading)',
      marginBottom: 8
    }
  }, title), groups.map((g, gi) => /*#__PURE__*/React.createElement("div", {
    key: gi
  }, g.title && /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 11px var(--font-body)',
      letterSpacing: '.04em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
      margin: gi ? '10px 0 4px' : '0 0 4px'
    }
  }, g.title), g.rooms.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.n,
    style: {
      display: 'grid',
      gridTemplateColumns: '26px 1fr auto',
      alignItems: 'center',
      gap: 8,
      padding: '4px 0',
      borderBottom: '1px solid var(--grid-line)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 20,
      height: 20,
      borderRadius: '50%',
      background: r.wet ? 'var(--ld-blue-50)' : 'var(--ld-navy-50)',
      color: 'var(--ld-navy)',
      font: '600 11px/20px var(--font-display)',
      textAlign: 'center'
    }
  }, r.n), /*#__PURE__*/React.createElement("span", null, r.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 500
    }
  }, fmt(r.area)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 12,
      whiteSpace: 'nowrap',
      marginTop: 8,
      font: '600 13px var(--font-display)',
      color: 'var(--text-heading)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u0412\u0441\u0435\u0433\u043E \u043F\u043E\u043C\u0435\u0449\u0435\u043D\u0438\u0439"), /*#__PURE__*/React.createElement("span", null, fmt(sum), " \u043C\xB2")));
}
Object.assign(__ds_scope, { Explication });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/drawings/Explication.jsx", error: String((e && e.message) || e) }); }

// components/drawings/RoomTag.jsx
try { (() => {
const fmt = n => typeof n === 'number' ? n.toFixed(1).replace('.', ',') : n;
function RoomTag({
  n,
  name,
  area,
  dims,
  wet = false,
  scale = 1,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6 * scale,
      fontVariantNumeric: 'tabular-nums',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 18 * scale,
      height: 18 * scale,
      flex: 'none',
      borderRadius: '50%',
      background: wet ? 'var(--ld-blue)' : 'var(--ld-navy)',
      color: '#fff',
      font: `600 ${10 * scale}px/${18 * scale}px var(--font-display)`,
      textAlign: 'center'
    }
  }, n), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      lineHeight: 1.15
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: `500 ${11 * scale}px var(--font-body)`,
      color: 'var(--plan-line)',
      whiteSpace: 'nowrap'
    }
  }, name), /*#__PURE__*/React.createElement("span", {
    style: {
      font: `600 ${11 * scale}px var(--font-display)`,
      color: 'var(--ld-navy)',
      whiteSpace: 'nowrap'
    }
  }, fmt(area), " \u043C\xB2", dims && /*#__PURE__*/React.createElement("span", {
    style: {
      font: `400 ${9 * scale}px var(--font-body)`,
      color: 'var(--plan-dim)',
      marginLeft: 6 * scale
    }
  }, dims))));
}
Object.assign(__ds_scope, { RoomTag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/drawings/RoomTag.jsx", error: String((e && e.message) || e) }); }

// components/drawings/TitleBlock.jsx
try { (() => {
function TitleBlock({
  logoSrc,
  project,
  stage = 'Эскизный проект',
  sheet,
  page,
  pages,
  date,
  style
}) {
  const c = {
    minWidth: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    borderLeft: 'var(--sheet-frame-w) solid var(--sheet-frame)',
    padding: '6px 10px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center'
  };
  const lab = {
    font: '400 9px var(--font-body)',
    color: 'var(--text-muted)'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '64px minmax(0,1fr) 92px',
      gridTemplateRows: '1fr 1fr',
      width: 440,
      height: 64,
      border: 'var(--sheet-frame-w) solid var(--sheet-frame)',
      background: '#fff',
      boxSizing: 'border-box',
      fontVariantNumeric: 'tabular-nums',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      gridColumn: 1,
      gridRow: '1 / 3',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, logoSrc && /*#__PURE__*/React.createElement("img", {
    src: logoSrc,
    alt: "",
    style: {
      height: 40
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      ...c,
      gridColumn: 2,
      gridRow: 1,
      borderBottom: '1px solid var(--sheet-frame)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '700 12px var(--font-display)',
      color: 'var(--ld-navy)'
    }
  }, project, " \xB7 ", stage)), /*#__PURE__*/React.createElement("div", {
    style: {
      ...c,
      gridColumn: 3,
      gridRow: '1 / 3',
      alignItems: 'center',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: lab
  }, "\u041B\u0438\u0441\u0442"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '600 16px var(--font-display)',
      color: 'var(--text-primary)'
    }
  }, page, " / ", pages)), /*#__PURE__*/React.createElement("div", {
    style: {
      ...c,
      gridColumn: 2,
      gridRow: 2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 11px var(--font-body)'
    }
  }, sheet), date && /*#__PURE__*/React.createElement("span", {
    style: lab
  }, date)));
}
Object.assign(__ds_scope, { TitleBlock });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/drawings/TitleBlock.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Badge.jsx
try { (() => {
const TONES = {
  navy: ['var(--ld-navy)', '#fff'],
  orange: ['var(--ld-orange)', '#fff'],
  cyan: ['var(--ld-cyan)', '#fff'],
  coral: ['var(--ld-coral)', '#fff'],
  blue: ['var(--ld-blue)', '#fff'],
  soft: ['var(--surface-soft)', 'var(--text-primary)'],
  outline: ['#fff', 'var(--text-secondary)']
};
function Badge({
  tone = 'navy',
  children,
  style
}) {
  const [bg, fg] = TONES[tone] || TONES.navy;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      height: 22,
      padding: '0 8px',
      borderRadius: 'var(--radius-xs)',
      background: bg,
      color: fg,
      font: '600 12px/1 var(--font-body)',
      border: tone === 'outline' ? '1px solid var(--border-default)' : 'none',
      boxSizing: 'border-box',
      whiteSpace: 'nowrap',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Badge.jsx", error: String((e && e.message) || e) }); }

// components/cards/ProjectCard.jsx
try { (() => {
const BT = {
  'Популярный': 'navy',
  'Новинка': 'cyan',
  'Акция': 'coral',
  'Премиум': 'orange'
};
function ProjectCard({
  image,
  title,
  area,
  rooms,
  baths,
  floors,
  price,
  badge,
  favorite = false,
  onFavorite,
  onOpen,
  style
}) {
  const [h, setH] = React.useState(false);
  const [fav, setFav] = React.useState(favorite);
  const spec = (ic, t) => t != null && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: ic,
    size: 14,
    color: "var(--ld-gray-500)"
  }), t);
  return /*#__PURE__*/React.createElement("article", {
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    onClick: onOpen,
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      boxShadow: h ? 'var(--shadow-hover)' : 'var(--shadow-card)',
      transform: h ? 'translateY(-2px)' : 'none',
      transition: 'box-shadow var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)',
      cursor: onOpen ? 'pointer' : 'default',
      display: 'flex',
      flexDirection: 'column',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      aspectRatio: '4/3',
      background: 'var(--surface-soft)'
    }
  }, image && /*#__PURE__*/React.createElement("img", {
    src: image,
    alt: "",
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block'
    }
  }), badge && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: BT[badge] || 'navy',
    style: {
      position: 'absolute',
      top: 12,
      left: 12
    }
  }, badge), /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      setFav(!fav);
      onFavorite && onFavorite(!fav);
    },
    "aria-label": "\u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435",
    style: {
      position: 'absolute',
      top: 10,
      right: 10,
      width: 32,
      height: 32,
      borderRadius: '50%',
      border: 0,
      background: 'rgba(255,255,255,.92)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "heart",
    size: 16,
    color: fav ? 'var(--ld-coral)' : 'var(--ld-graphite)'
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--text-h4)',
      fontSize: 18,
      color: 'var(--text-heading)'
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 14,
      flexWrap: 'wrap',
      font: '400 13px var(--font-body)',
      color: 'var(--text-secondary)'
    }
  }, spec('ruler', area != null ? area + ' м²' : null), spec('bed-double', rooms), spec('bath', baths), spec('layers', floors != null ? floors + ' эт.' : null)), price != null && /*#__PURE__*/React.createElement("div", {
    style: {
      font: '700 20px var(--font-display)',
      color: 'var(--text-primary)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '400 14px var(--font-body)',
      color: 'var(--text-secondary)'
    }
  }, "\u043E\u0442 "), price.toLocaleString('ru-RU'), " \u20BD"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      font: '600 14px var(--font-body)',
      color: h ? 'var(--ld-navy)' : 'var(--ld-blue)'
    }
  }, "\u041F\u043E\u0434\u0440\u043E\u0431\u043D\u0435\u0435", /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "arrow-right",
    size: 16
  }))));
}
Object.assign(__ds_scope, { ProjectCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/ProjectCard.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Rating.jsx
try { (() => {
function Rating({
  value = 0,
  reviews,
  size = 14,
  showValue = true,
  style
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      font: '600 14px var(--font-body)',
      color: 'var(--text-primary)',
      ...style
    }
  }, showValue && /*#__PURE__*/React.createElement("span", null, value.toFixed(1)), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      gap: 1
    }
  }, [1, 2, 3, 4, 5].map(i => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      width: size,
      height: size,
      background: i <= Math.round(value) ? 'var(--rating-star)' : 'var(--ld-tech-gray)',
      clipPath: 'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)'
    }
  }))), reviews != null && /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 400,
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, reviews, " \u043E\u0442\u0437\u044B\u0432\u043E\u0432"));
}
Object.assign(__ds_scope, { Rating });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Rating.jsx", error: String((e && e.message) || e) }); }

// components/cards/ContractorCard.jsx
try { (() => {
function ContractorCard({
  name,
  role,
  avatar,
  rating,
  reviews,
  location,
  experience,
  verified = false,
  contract = false,
  primaryLabel = 'Связаться',
  secondaryLabel,
  onPrimary,
  onSecondary,
  style
}) {
  return /*#__PURE__*/React.createElement("article", {
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-card)',
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 14,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 56,
      height: 56,
      borderRadius: '50%',
      overflow: 'hidden',
      flex: 'none',
      background: 'var(--ld-navy-50)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, avatar ? /*#__PURE__*/React.createElement("img", {
    src: avatar,
    alt: "",
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      font: '700 20px var(--font-display)',
      color: 'var(--ld-navy)'
    }
  }, (name || '?').split(' ').map(w => w[0]).slice(0, 2).join(''))), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 17px var(--font-display)',
      color: 'var(--text-heading)'
    }
  }, name), role && /*#__PURE__*/React.createElement("div", {
    style: {
      font: '400 13px/1.35 var(--font-body)',
      color: 'var(--text-secondary)'
    }
  }, role))), rating != null && /*#__PURE__*/React.createElement(__ds_scope.Rating, {
    value: rating,
    reviews: reviews
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      font: '400 13px var(--font-body)',
      color: 'var(--text-secondary)'
    }
  }, location && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "map-pin",
    size: 14
  }), location), experience && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "briefcase",
    size: 14
  }), "\u041E\u043F\u044B\u0442 ", experience)), (verified || contract) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      font: '500 12px var(--font-body)'
    }
  }, verified && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      color: 'var(--ld-cyan)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "badge-check",
    size: 14
  }), "\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D"), contract && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      color: 'var(--text-secondary)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "file-check",
    size: 14
  }), "\u0414\u043E\u0433\u043E\u0432\u043E\u0440")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginTop: 'auto'
    }
  }, primaryLabel && /*#__PURE__*/React.createElement(__ds_scope.Button, {
    fullWidth: true,
    iconRight: "arrow-right",
    onClick: onPrimary
  }, primaryLabel), secondaryLabel && /*#__PURE__*/React.createElement(__ds_scope.Button, {
    fullWidth: true,
    variant: "secondary",
    onClick: onSecondary
  }, secondaryLabel)));
}
Object.assign(__ds_scope, { ContractorCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/ContractorCard.jsx", error: String((e && e.message) || e) }); }

// components/feedback/StatusDot.jsx
try { (() => {
const MAP = {
  draft: ['var(--status-draft)', 'Черновик'],
  review: ['var(--status-review)', 'На согласовании'],
  progress: ['var(--status-progress)', 'В работе'],
  done: ['var(--status-done)', 'Завершён']
};
function StatusDot({
  status = 'draft',
  label,
  style
}) {
  const [c, l] = MAP[status] || MAP.draft;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      font: '400 13px var(--font-body)',
      color: 'var(--text-primary)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: c,
      flex: 'none'
    }
  }), label ?? l);
}
Object.assign(__ds_scope, { StatusDot });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/StatusDot.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function Checkbox({
  label,
  checked,
  defaultChecked = false,
  onChange,
  disabled,
  style
}) {
  const [i, setI] = React.useState(defaultChecked);
  const on = checked ?? i;
  const t = () => {
    if (disabled) return;
    setI(!on);
    onChange && onChange(!on);
  };
  return /*#__PURE__*/React.createElement("span", {
    onClick: t,
    role: "checkbox",
    "aria-checked": on,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? .5 : 1,
      font: '400 14px var(--font-body)',
      color: 'var(--text-primary)',
      userSelect: 'none',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 18,
      height: 18,
      boxSizing: 'border-box',
      borderRadius: 4,
      border: `1px solid ${on ? 'var(--ld-navy)' : 'var(--border-strong)'}`,
      background: on ? 'var(--ld-navy)' : '#fff',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background var(--dur-fast)'
    }
  }, on && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: 13,
    color: "#fff"
  })), label);
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const labelS = {
  font: '500 13px/1.3 var(--font-body)',
  color: 'var(--text-secondary)'
};
const boxS = (f, e) => ({
  height: 40,
  boxSizing: 'border-box',
  border: `1px solid ${e ? 'var(--ld-coral)' : f ? 'var(--border-focus)' : 'var(--border-default)'}`,
  borderRadius: 'var(--radius-sm)',
  background: '#fff',
  boxShadow: f ? 'var(--focus-ring)' : 'none',
  transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)'
});
function Input({
  label,
  placeholder,
  value,
  defaultValue,
  onChange,
  icon,
  suffix,
  error,
  type = 'text',
  style,
  ...rest
}) {
  const [f, setF] = React.useState(false);
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: labelS
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      ...boxS(f, error),
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '0 12px'
    }
  }, icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 16,
    color: "var(--ld-gray-500)"
  }), /*#__PURE__*/React.createElement("input", _extends({}, rest, {
    type: type,
    placeholder: placeholder,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    onFocus: () => setF(true),
    onBlur: () => setF(false),
    style: {
      flex: 1,
      minWidth: 0,
      border: 0,
      outline: 0,
      background: 'transparent',
      font: '400 14px var(--font-body)',
      color: 'var(--text-primary)'
    }
  })), suffix && /*#__PURE__*/React.createElement("span", {
    style: {
      font: '400 13px var(--font-body)',
      color: 'var(--text-muted)'
    }
  }, suffix)), error && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-caption)',
      color: 'var(--ld-coral)'
    }
  }, error));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Radio.jsx
try { (() => {
function Radio({
  options = [],
  value,
  defaultValue,
  onChange,
  name,
  direction = 'row',
  style
}) {
  const [i, setI] = React.useState(defaultValue ?? (options[0] && (options[0].value ?? options[0])));
  const cur = value ?? i;
  return /*#__PURE__*/React.createElement("div", {
    role: "radiogroup",
    style: {
      display: 'flex',
      flexDirection: direction,
      gap: direction === 'row' ? 24 : 10,
      ...style
    }
  }, options.map(o => {
    const v = o.value ?? o,
      l = o.label ?? o,
      on = v === cur;
    return /*#__PURE__*/React.createElement("span", {
      key: v,
      role: "radio",
      "aria-checked": on,
      onClick: () => {
        setI(v);
        onChange && onChange(v);
      },
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        font: '400 14px var(--font-body)',
        userSelect: 'none'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 18,
        height: 18,
        boxSizing: 'border-box',
        borderRadius: '50%',
        border: `1px solid ${on ? 'var(--ld-navy)' : 'var(--border-strong)'}`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fff'
      }
    }, on && /*#__PURE__*/React.createElement("span", {
      style: {
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: 'var(--ld-navy)'
      }
    })), l);
  }));
}
Object.assign(__ds_scope, { Radio });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Radio.jsx", error: String((e && e.message) || e) }); }

// components/forms/RangeSlider.jsx
try { (() => {
function RangeSlider({
  min = 0,
  max = 100,
  step = 1,
  value,
  defaultValue,
  onChange,
  label,
  unit = '',
  format,
  style
}) {
  const [i, setI] = React.useState(defaultValue ?? [min, max]);
  const v = value ?? i;
  const fmt = format || (n => n.toLocaleString('ru-RU'));
  const ref = React.useRef(null);
  const pct = n => (n - min) / (max - min) * 100;
  const drag = idx => e => {
    e.preventDefault();
    const r = ref.current.getBoundingClientRect();
    const mv = ev => {
      let n = min + Math.round(Math.min(Math.max(ev.clientX - r.left, 0), r.width) / r.width * (max - min) / step) * step;
      const nv = [...v];
      nv[idx] = idx === 0 ? Math.min(n, v[1]) : Math.max(n, v[0]);
      v[idx] = nv[idx];
      setI(nv);
      onChange && onChange(nv);
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const box = {
    flex: 1,
    height: 36,
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    alignItems: 'center',
    padding: '0 10px',
    font: '400 13px var(--font-body)',
    fontVariantNumeric: 'tabular-nums'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 13px var(--font-body)',
      color: 'var(--text-secondary)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: box
  }, fmt(v[0]), unit && ' ' + unit), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      borderTop: '1px solid var(--ld-gray-400)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: box
  }, fmt(v[1]), unit && ' ' + unit)), /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: 'relative',
      height: 16,
      margin: '0 7px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 7,
      left: 0,
      right: 0,
      height: 2,
      background: 'var(--ld-tech-gray)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 7,
      height: 2,
      left: pct(v[0]) + '%',
      width: pct(v[1]) - pct(v[0]) + '%',
      background: 'var(--ld-navy)'
    }
  }), [0, 1].map(k => /*#__PURE__*/React.createElement("span", {
    key: k,
    onPointerDown: drag(k),
    style: {
      position: 'absolute',
      top: 1,
      left: `calc(${pct(v[k])}% - 7px)`,
      width: 14,
      height: 14,
      borderRadius: '50%',
      background: 'var(--ld-navy)',
      boxShadow: '0 0 0 3px #fff, 0 1px 4px rgba(13,26,69,.3)',
      cursor: 'grab',
      touchAction: 'none'
    }
  }))));
}
Object.assign(__ds_scope, { RangeSlider });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/RangeSlider.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
const labelS = {
  font: '500 13px/1.3 var(--font-body)',
  color: 'var(--text-secondary)'
};
const boxS = (f, e) => ({
  height: 40,
  boxSizing: 'border-box',
  border: `1px solid ${e ? 'var(--ld-coral)' : f ? 'var(--border-focus)' : 'var(--border-default)'}`,
  borderRadius: 'var(--radius-sm)',
  background: '#fff',
  boxShadow: f ? 'var(--focus-ring)' : 'none',
  transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)'
});
function Select({
  label,
  options = [],
  value,
  defaultValue,
  onChange,
  placeholder,
  style
}) {
  const [f, setF] = React.useState(false);
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: labelS
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      ...boxS(f),
      position: 'relative',
      display: 'flex',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("select", {
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    onFocus: () => setF(true),
    onBlur: () => setF(false),
    style: {
      appearance: 'none',
      WebkitAppearance: 'none',
      flex: 1,
      height: '100%',
      border: 0,
      outline: 0,
      background: 'transparent',
      padding: '0 36px 0 12px',
      font: '400 14px var(--font-body)',
      color: 'var(--text-primary)',
      cursor: 'pointer'
    }
  }, placeholder && /*#__PURE__*/React.createElement("option", {
    value: ""
  }, placeholder), options.map(o => typeof o === 'string' ? /*#__PURE__*/React.createElement("option", {
    key: o
  }, o) : /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label))), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 16,
    color: "var(--ld-gray-500)",
    style: {
      position: 'absolute',
      right: 12,
      pointerEvents: 'none'
    }
  })));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Breadcrumbs.jsx
try { (() => {
function Breadcrumbs({
  items = [],
  onNavigate,
  style
}) {
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
      font: '400 13px var(--font-body)',
      ...style
    }
  }, items.map((it, i) => {
    const last = i === items.length - 1;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, last ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-primary)'
      }
    }, it) : /*#__PURE__*/React.createElement("a", {
      href: "#",
      onClick: e => {
        e.preventDefault();
        onNavigate && onNavigate(it, i);
      },
      style: {
        color: 'var(--text-muted)'
      }
    }, it), !last && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "chevron-right",
      size: 14,
      color: "var(--ld-gray-400)"
    }));
  }));
}
Object.assign(__ds_scope, { Breadcrumbs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Breadcrumbs.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Header.jsx
try { (() => {
function Wordmark({
  src,
  height = 36,
  inverse = false,
  onClick
}) {
  if (src) return /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: "\u041B\u043E\u0433\u0438\u043A\u0430 \u0414\u043E\u043C\u0430",
    onClick: onClick,
    style: {
      height,
      display: 'block',
      cursor: onClick ? 'pointer' : undefined,
      filter: inverse ? 'brightness(0) invert(1)' : undefined
    }
  });
  return /*#__PURE__*/React.createElement("span", {
    onClick: onClick,
    style: {
      font: `700 ${Math.round(height * 0.42)}px/0.95 var(--font-display)`,
      letterSpacing: '.06em',
      color: inverse ? '#fff' : 'var(--ld-navy)',
      cursor: onClick ? 'pointer' : undefined
    }
  }, "\u041B\u041E\u0413\u0418\u041A\u0410", /*#__PURE__*/React.createElement("br", null), "\u0414\u041E\u041C\u0410");
}
const DEFAULT_NAV = ['Проекты', 'Подрядчики', 'Журнал', 'О сервисе'];
function Header({
  logoSrc,
  nav = DEFAULT_NAV,
  active,
  onNavigate,
  onLogo,
  ctaLabel = 'Войти',
  onCta,
  variant = 'desktop',
  style
}) {
  if (variant === 'mobile') return /*#__PURE__*/React.createElement("header", {
    style: {
      height: 56,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '0 8px',
      background: '#fff',
      borderBottom: '1px solid var(--border-default)',
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "menu",
    variant: "ghost",
    label: "\u041C\u0435\u043D\u044E"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    src: logoSrc,
    height: 28,
    onClick: onLogo
  })), /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "search",
    variant: "ghost",
    label: "\u041F\u043E\u0438\u0441\u043A"
  }), /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "user",
    variant: "ghost",
    label: "\u041F\u0440\u043E\u0444\u0438\u043B\u044C"
  }));
  return /*#__PURE__*/React.createElement("header", {
    style: {
      height: 'var(--header-h)',
      display: 'flex',
      alignItems: 'center',
      gap: 40,
      padding: '0 32px',
      background: '#fff',
      borderBottom: '1px solid var(--border-default)',
      ...style
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    src: logoSrc,
    height: 38,
    onClick: onLogo
  }), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      gap: 28,
      flex: 1
    }
  }, nav.map(n => {
    const on = n === active;
    return /*#__PURE__*/React.createElement("a", {
      key: n,
      href: "#",
      onClick: e => {
        e.preventDefault();
        onNavigate && onNavigate(n);
      },
      style: {
        font: `${on ? 600 : 500} 14px var(--font-body)`,
        color: on ? 'var(--ld-navy)' : 'var(--text-primary)',
        padding: '26px 0',
        borderBottom: on ? '2px solid var(--ld-cyan)' : '2px solid transparent'
      }
    }, n);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "search",
    variant: "ghost",
    label: "\u041F\u043E\u0438\u0441\u043A"
  }), /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "heart",
    variant: "ghost",
    label: "\u0418\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435"
  }), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    size: "sm",
    onClick: onCta
  }, ctaLabel)));
}
Object.assign(__ds_scope, { Wordmark, Header });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Header.jsx", error: String((e && e.message) || e) }); }

// components/navigation/StepPath.jsx
try { (() => {
const DEF = ['Идея', 'Проект', 'Настройка', 'Подрядчик', 'Дом'];
function StepPath({
  steps = DEF,
  current = 0,
  onSelect,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      ...style
    }
  }, steps.map((s, i) => {
    const done = i < current,
      on = i === current;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, /*#__PURE__*/React.createElement("div", {
      onClick: () => onSelect && onSelect(i),
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        cursor: onSelect ? 'pointer' : 'default',
        minWidth: 64
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 44,
        height: 44,
        boxSizing: 'border-box',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: '600 15px var(--font-display)',
        border: `1.5px solid ${on ? 'var(--ld-cyan)' : done ? 'var(--ld-navy)' : 'var(--border-strong)'}`,
        background: done ? 'var(--ld-navy)' : on ? 'var(--ld-cyan-50)' : '#fff',
        color: done ? '#fff' : 'var(--ld-navy)'
      }
    }, String(i + 1).padStart(2, '0')), /*#__PURE__*/React.createElement("span", {
      style: {
        font: `${on ? 600 : 400} 13px var(--font-body)`,
        color: on ? 'var(--ld-navy)' : 'var(--text-secondary)'
      }
    }, s)), i < steps.length - 1 && /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        height: 44,
        minWidth: 24
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        borderTop: `1px solid ${done ? 'var(--ld-navy)' : 'var(--ld-gray-400)'}`
      }
    }), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "chevron-right",
      size: 12,
      color: done ? 'var(--ld-navy)' : 'var(--ld-gray-400)',
      style: {
        marginLeft: -6
      }
    })));
  }));
}
Object.assign(__ds_scope, { StepPath });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/StepPath.jsx", error: String((e && e.message) || e) }); }

// ui_kits/platform/Catalog.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Catalog({
  go
}) {
  const {
    Breadcrumbs,
    Select,
    RangeSlider,
    Checkbox,
    Button,
    ProjectCard,
    Radio
  } = NSX;
  const D = window.LD_DATA;
  const [price, setPrice] = React.useState([2000000, 10000000]);
  const [type, setType] = React.useState('Все');
  const list = D.projects.filter(p => p.price >= price[0] && p.price <= price[1] && (type === 'Все' || p.type === type));
  return /*#__PURE__*/React.createElement(Container, {
    style: {
      padding: '24px 32px 0'
    }
  }, /*#__PURE__*/React.createElement(Breadcrumbs, {
    items: ['Главная', 'Проекты'],
    onNavigate: () => go('home')
  }), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: 'var(--text-h1)',
      color: 'var(--text-heading)',
      margin: '16px 0 28px'
    }
  }, "\u041F\u0440\u043E\u0435\u043A\u0442\u044B \u0434\u043E\u043C\u043E\u0432"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '280px minmax(0,1fr)',
      gap: 28,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      background: '#fff',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)',
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
      position: 'sticky',
      top: 88
    }
  }, /*#__PURE__*/React.createElement(Select, {
    label: "\u0422\u0438\u043F \u0434\u043E\u043C\u0430",
    options: ['Все', 'Коттедж', 'Дуплекс', 'Баня'],
    value: type,
    onChange: e => setType(e.target.value)
  }), /*#__PURE__*/React.createElement(RangeSlider, {
    label: "\u041F\u043B\u043E\u0449\u0430\u0434\u044C, \u043C\xB2",
    min: 40,
    max: 300,
    defaultValue: [80, 200]
  }), /*#__PURE__*/React.createElement(RangeSlider, {
    label: "\u0421\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C, \u20BD",
    min: 2000000,
    max: 10000000,
    step: 50000,
    value: price,
    onChange: setPrice
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 13px var(--font-body)',
      color: 'var(--text-secondary)'
    }
  }, "\u042D\u0442\u0430\u0436\u043D\u043E\u0441\u0442\u044C"), /*#__PURE__*/React.createElement(Radio, {
    direction: "row",
    options: ['1', '2', 'Любая'],
    defaultValue: "\u041B\u044E\u0431\u0430\u044F"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 13px var(--font-body)',
      color: 'var(--text-secondary)'
    }
  }, "\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Checkbox, {
    label: "\u0413\u0430\u0440\u0430\u0436"
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "\u0422\u0435\u0440\u0440\u0430\u0441\u0430"
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "\u041A\u0430\u043C\u0438\u043D"
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "\u0411\u0430\u043D\u044F"
  }))), /*#__PURE__*/React.createElement(Button, {
    fullWidth: true
  }, "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C ", list.length, " \u043F\u0440\u043E\u0435\u043A\u0442\u043E\u0432")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-secondary-font)',
      color: 'var(--text-secondary)'
    }
  }, "\u041D\u0430\u0439\u0434\u0435\u043D\u043E ", list.length, " \u043F\u0440\u043E\u0435\u043A\u0442\u043E\u0432"), /*#__PURE__*/React.createElement(Select, {
    options: ['Сначала популярные', 'Сначала дешевле', 'Сначала дороже'],
    style: {
      width: 220
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
      gap: 20
    }
  }, list.map(p => /*#__PURE__*/React.createElement(ProjectCard, _extends({
    key: p.id
  }, p, {
    onOpen: () => go('project', p.id)
  })))), list.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 48,
      textAlign: 'center',
      color: 'var(--text-muted)'
    }
  }, "\u041D\u0435\u0442 \u043F\u0440\u043E\u0435\u043A\u0442\u043E\u0432 \u043F\u043E\u0434 \u044D\u0442\u0438 \u0444\u0438\u043B\u044C\u0442\u0440\u044B"))));
}
window.Catalog = Catalog;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/platform/Catalog.jsx", error: String((e && e.message) || e) }); }

// ui_kits/platform/ContractorPage.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function ContractorPage({
  go
}) {
  const {
    Breadcrumbs,
    Button,
    Rating,
    Icon,
    ProjectCard,
    Badge
  } = NSX;
  const D = window.LD_DATA;
  const c = D.contractors[0];
  const [tab, setTab] = React.useState('О компании');
  const tabs = ['О компании', 'Проекты', 'Отзывы'];
  const stats = [['95', 'Построено домов'], ['14 лет', 'На рынке'], ['320+', 'Отзывов'], ['4.9', 'Средний рейтинг']];
  return /*#__PURE__*/React.createElement(Container, {
    style: {
      padding: '24px 32px 0'
    }
  }, /*#__PURE__*/React.createElement(Breadcrumbs, {
    items: ['Главная', 'Подрядчики', c.name],
    onNavigate: () => go('home')
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 24,
      alignItems: 'center',
      margin: '20px 0 28px',
      background: '#fff',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)',
      padding: 28
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 88,
      height: 88,
      borderRadius: '50%',
      background: 'var(--ld-navy-50)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      font: '700 30px var(--font-display)',
      color: 'var(--ld-navy)'
    }
  }, "\u0421\u041B"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: 'var(--text-h2)',
      color: 'var(--text-heading)',
      margin: 0
    }
  }, c.name), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      font: '500 13px var(--font-body)',
      color: 'var(--ld-cyan)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "badge-check",
    size: 16
  }), "\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D")), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-secondary)'
    }
  }, c.role), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 20,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Rating, {
    value: c.rating,
    reviews: c.reviews
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      gap: 6,
      alignItems: 'center',
      font: '400 13px var(--font-body)',
      color: 'var(--text-secondary)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "map-pin",
    size: 14
  }), c.location))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    icon: "message-circle"
  }, "\u041D\u0430\u043F\u0438\u0441\u0430\u0442\u044C"), /*#__PURE__*/React.createElement(Button, {
    iconRight: "arrow-right"
  }, "\u0421\u0432\u044F\u0437\u0430\u0442\u044C\u0441\u044F"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 16
    }
  }, stats.map(([v, l]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      background: '#fff',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '700 32px var(--font-display)',
      color: 'var(--text-heading)'
    }
  }, v), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--text-secondary-font)',
      color: 'var(--text-secondary)'
    }
  }, l)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 28,
      borderBottom: '1px solid var(--border-default)',
      margin: '36px 0 24px'
    }
  }, tabs.map(t => /*#__PURE__*/React.createElement("a", {
    key: t,
    href: "#",
    onClick: e => {
      e.preventDefault();
      setTab(t);
    },
    style: {
      padding: '12px 0',
      font: `${t === tab ? 600 : 500} 15px var(--font-body)`,
      color: t === tab ? 'var(--ld-navy)' : 'var(--text-secondary)',
      borderBottom: t === tab ? '2px solid var(--ld-cyan)' : '2px solid transparent',
      marginBottom: -1
    }
  }, t))), tab === 'О компании' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)',
      gap: 28
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--text-body-lg, 400 18px/1.55 var(--font-body))',
      margin: 0
    }
  }, "\u0421\u0442\u0440\u043E\u0438\u043C \u043A\u0430\u0440\u043A\u0430\u0441\u043D\u044B\u0435 \u0438 \u0433\u0430\u0437\u043E\u0431\u0435\u0442\u043E\u043D\u043D\u044B\u0435 \u0434\u043E\u043C\u0430 \u043F\u043E\u0434 \u043A\u043B\u044E\u0447 \u0441 2012 \u0433\u043E\u0434\u0430. \u0420\u0430\u0431\u043E\u0442\u0430\u0435\u043C \u043F\u043E \u0434\u043E\u0433\u043E\u0432\u043E\u0440\u0443 \u0441 \u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u043E\u0439 \u0441\u043C\u0435\u0442\u043E\u0439, \u0444\u043E\u0442\u043E\u043E\u0442\u0447\u0451\u0442\u0430\u043C\u0438 \u043A\u0430\u0436\u0434\u043E\u0433\u043E \u044D\u0442\u0430\u043F\u0430 \u0438 \u0433\u0430\u0440\u0430\u043D\u0442\u0438\u0435\u0439 5 \u043B\u0435\u0442."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
      alignContent: 'flex-start'
    }
  }, ['Каркасные дома', 'Газобетон', 'Фундаменты', 'Инженерия', 'Отделка'].map(t => /*#__PURE__*/React.createElement(Badge, {
    key: t,
    tone: "soft"
  }, t)))), tab === 'Проекты' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
      gap: 20
    }
  }, D.projects.slice(0, 3).map(p => /*#__PURE__*/React.createElement(ProjectCard, _extends({
    key: p.id
  }, p, {
    onOpen: () => go('project', p.id)
  })))), tab === 'Отзывы' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 20
    }
  }, D.reviews.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.name,
    style: {
      background: '#fff',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)',
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      font: '600 15px var(--font-display)'
    }
  }, r.name), /*#__PURE__*/React.createElement(Rating, {
    value: r.rating
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      color: 'var(--text-secondary)'
    }
  }, r.text)))));
}
window.ContractorPage = ContractorPage;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/platform/ContractorPage.jsx", error: String((e && e.message) || e) }); }

// ui_kits/platform/Home.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Home({
  go
}) {
  const {
    Button,
    Select,
    Input,
    StepPath,
    ProjectCard,
    ContractorCard,
    Icon
  } = NSX;
  const D = window.LD_DATA;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("section", {
    style: {
      position: 'relative',
      overflow: 'hidden',
      background: 'linear-gradient(180deg,#fff 0%,var(--surface-soft) 100%)',
      borderBottom: '1px solid var(--border-default)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      ...gridBg,
      opacity: .7
    }
  }, /*#__PURE__*/React.createElement(Nodes, {
    nodes: [[2, 1, 'cyan'], [9, 1, 'blue'], [5, 2, 'navy'], [1, 4, 'orange'], [12, 3, 'coral'], [16, 1, 'cool-gray'], [18, 4, 'cyan']]
  })), /*#__PURE__*/React.createElement(Container, {
    style: {
      position: 'relative',
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
      gap: 40,
      alignItems: 'center',
      padding: '72px 32px 40px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      font: 'var(--text-display)',
      color: 'var(--text-heading)',
      letterSpacing: 'var(--ls-heading)',
      textWrap: 'balance'
    }
  }, "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u043E\u043C. \u041F\u0440\u043E\u0434\u0443\u043C\u0430\u0439\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438. \u041D\u0430\u0439\u0434\u0438\u0442\u0435 \u043F\u043E\u0434\u0440\u044F\u0434\u0447\u0438\u043A\u0430."), /*#__PURE__*/React.createElement("p", {
    style: {
      font: '300 20px/1.5 var(--font-body)',
      color: 'var(--text-secondary)',
      margin: '20px 0 28px'
    }
  }, "\u041B\u043E\u0433\u0438\u043A\u0430. \u041F\u0440\u043E\u0435\u043A\u0442\u044B. \u041F\u043E\u0434\u0440\u044F\u0434\u0447\u0438\u043A\u0438."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    iconRight: "chevron-right",
    onClick: () => go('catalog')
  }, "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u043F\u0440\u043E\u0435\u043A\u0442"), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    variant: "secondary",
    onClick: () => go('contractor')
  }, "\u041D\u0430\u0439\u0442\u0438 \u043F\u043E\u0434\u0440\u044F\u0434\u0447\u0438\u043A\u0430"))), /*#__PURE__*/React.createElement("img", {
    src: "../../assets/images/house-04.png",
    alt: "",
    style: {
      width: '100%',
      aspectRatio: '4/3',
      objectFit: 'cover',
      borderRadius: 'var(--radius-xl)',
      boxShadow: 'var(--shadow-pop)'
    }
  })), /*#__PURE__*/React.createElement(Container, {
    style: {
      position: 'relative',
      paddingBottom: 48
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: '#fff',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-card)',
      padding: 16,
      display: 'grid',
      gridTemplateColumns: 'repeat(4,minmax(0,1fr)) auto',
      gap: 12,
      alignItems: 'end'
    }
  }, /*#__PURE__*/React.createElement(Select, {
    label: "\u0422\u0438\u043F \u0434\u043E\u043C\u0430",
    options: ['Коттедж', 'Дуплекс', 'Таунхаус', 'Баня']
  }), /*#__PURE__*/React.createElement(Select, {
    label: "\u041F\u043B\u043E\u0449\u0430\u0434\u044C",
    options: ['до 100 м²', '100–150 м²', '150–200 м²', 'от 200 м²']
  }), /*#__PURE__*/React.createElement(Select, {
    label: "\u042D\u0442\u0430\u0436\u043D\u043E\u0441\u0442\u044C",
    options: ['1 этаж', '2 этажа', 'Мансарда']
  }), /*#__PURE__*/React.createElement(Select, {
    label: "\u0411\u044E\u0434\u0436\u0435\u0442",
    options: ['до 4 млн ₽', '4–6 млн ₽', '6–10 млн ₽']
  }), /*#__PURE__*/React.createElement(Button, {
    onClick: () => go('catalog'),
    icon: "search"
  }, "\u041D\u0430\u0439\u0442\u0438")))), /*#__PURE__*/React.createElement(Container, {
    style: {
      padding: '64px 32px 0'
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "5 \u0448\u0430\u0433\u043E\u0432 \u043A \u0434\u043E\u043C\u0443"), /*#__PURE__*/React.createElement("div", {
    style: {
      background: '#fff',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)',
      padding: '28px 32px'
    }
  }, /*#__PURE__*/React.createElement(StepPath, {
    current: 0
  }))), /*#__PURE__*/React.createElement(Container, {
    style: {
      padding: '64px 32px 0'
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, {
    action: /*#__PURE__*/React.createElement(NSX.Button, {
      variant: "tertiary",
      iconRight: "arrow-right",
      onClick: () => go('catalog')
    }, "\u0412\u0441\u0435 \u043F\u0440\u043E\u0435\u043A\u0442\u044B")
  }, "\u041F\u043E\u043F\u0443\u043B\u044F\u0440\u043D\u044B\u0435 \u043F\u0440\u043E\u0435\u043A\u0442\u044B"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
      gap: 20
    }
  }, D.projects.slice(0, 3).map(p => /*#__PURE__*/React.createElement(ProjectCard, _extends({
    key: p.id
  }, p, {
    onOpen: () => go('project', p.id)
  }))))), /*#__PURE__*/React.createElement(Container, {
    style: {
      padding: '64px 32px 0'
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043D\u044B\u0435 \u043F\u043E\u0434\u0440\u044F\u0434\u0447\u0438\u043A\u0438"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
      gap: 20
    }
  }, D.contractors.map(c => /*#__PURE__*/React.createElement(ContractorCard, _extends({
    key: c.id
  }, c, {
    primaryLabel: c.avatar ? null : 'Связаться',
    secondaryLabel: c.avatar ? 'Профиль' : undefined,
    onPrimary: () => go('contractor'),
    onSecondary: () => go('contractor')
  }))))), /*#__PURE__*/React.createElement(Container, {
    style: {
      padding: '64px 32px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      overflow: 'hidden',
      background: 'var(--ld-navy)',
      borderRadius: 'var(--radius-xl)',
      padding: '48px 56px',
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      backgroundImage: 'linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px)',
      backgroundSize: '64px 64px'
    }
  }, /*#__PURE__*/React.createElement(Nodes, {
    dark: true,
    nodes: [[11, 1, 'cyan'], [14, 2, 'blue'], [16, 1, 'orange'], [13, 3, 'coral']]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      maxWidth: 520
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: 'var(--text-h2)'
    }
  }, "\u041D\u0430\u0439\u0434\u0438\u0442\u0435 \u043F\u0440\u043E\u0435\u043A\u0442 \u0438\u043B\u0438 \u0441\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u0441\u0432\u043E\u0439"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--text-body)',
      opacity: .85,
      margin: '12px 0 24px'
    }
  }, "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u0442\u0435 \u043F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u043A\u0443, \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u044B \u0438 \u0438\u043D\u0436\u0435\u043D\u0435\u0440\u0438\u044E \u2014 \u0441\u043C\u0435\u0442\u0430 \u043F\u0435\u0440\u0435\u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438."), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: () => go('catalog')
  }, "\u041F\u043E\u0434\u043E\u0431\u0440\u0430\u0442\u044C \u043F\u0440\u043E\u0435\u043A\u0442")))));
}
window.Home = Home;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/platform/Home.jsx", error: String((e && e.message) || e) }); }

// ui_kits/platform/ProjectPage.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function ProjectPage({
  go,
  id
}) {
  const {
    Breadcrumbs,
    Button,
    IconButton,
    Badge,
    Checkbox,
    StatusDot,
    ContractorCard,
    Icon,
    StepPath
  } = NSX;
  const D = window.LD_DATA;
  const p = D.projects.find(x => x.id === id) || D.projects[0];
  const [img, setImg] = React.useState(0);
  const imgs = [p.image, '../../assets/images/plan-01.png', '../../assets/images/plan-02.png'];
  const opts = [['Гараж на 1 авто', 420000], ['Терраса 24 м²', 310000], ['Камин', 180000], ['Тёплый пол', 240000]];
  const [sel, setSel] = React.useState({});
  const total = p.price + opts.reduce((s, [n, v]) => s + (sel[n] ? v : 0), 0);
  const spec = [['ruler', 'Площадь', p.area + ' м²'], ['bed-double', 'Комнаты', p.rooms], ['bath', 'Санузлы', p.baths], ['layers', 'Этажи', p.floors]];
  return /*#__PURE__*/React.createElement(Container, {
    style: {
      padding: '24px 32px 0'
    }
  }, /*#__PURE__*/React.createElement(Breadcrumbs, {
    items: ['Главная', 'Проекты', p.title],
    onNavigate: it => go(it === 'Главная' ? 'home' : 'catalog')
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      margin: '16px 0 24px'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: 'var(--text-h1)',
      color: 'var(--text-heading)',
      margin: 0
    }
  }, p.title), p.badge && /*#__PURE__*/React.createElement(Badge, null, p.badge), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "heart",
    label: "\u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435"
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "share-2",
    label: "\u041F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F"
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "download",
    label: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C PDF"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)',
      gap: 28,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: imgs[img],
    alt: "",
    style: {
      width: '100%',
      aspectRatio: '16/10',
      objectFit: 'cover',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border-default)',
      background: '#fff'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12
    }
  }, imgs.map((s, i) => /*#__PURE__*/React.createElement("img", {
    key: i,
    src: s,
    onClick: () => setImg(i),
    style: {
      width: 120,
      height: 80,
      objectFit: 'cover',
      borderRadius: 'var(--radius-md)',
      cursor: 'pointer',
      border: i === img ? '2px solid var(--ld-cyan)' : '1px solid var(--border-default)',
      boxSizing: 'border-box'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 12,
      marginTop: 12
    }
  }, spec.map(([ic, l, v]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      background: '#fff',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: ic,
    color: "var(--ld-cyan)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-caption)',
      color: 'var(--text-muted)'
    }
  }, l), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '700 20px var(--font-display)',
      color: 'var(--text-heading)'
    }
  }, v)))), /*#__PURE__*/React.createElement("h2", {
    style: {
      font: 'var(--text-h3)',
      color: 'var(--text-heading)',
      margin: '24px 0 0'
    }
  }, "\u041E \u043F\u0440\u043E\u0435\u043A\u0442\u0435"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--text-body)',
      color: 'var(--text-primary)',
      margin: 0,
      maxWidth: 640
    }
  }, "\u0414\u0432\u0443\u0445\u044D\u0442\u0430\u0436\u043D\u044B\u0439 \u0434\u043E\u043C \u0441 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0439 \u0433\u043E\u0441\u0442\u0438\u043D\u043E\u0439-\u043A\u0443\u0445\u043D\u0435\u0439, \u043C\u0430\u0441\u0442\u0435\u0440-\u0441\u043F\u0430\u043B\u044C\u043D\u0435\u0439 \u0438 \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u043E\u043C. \u041F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u043A\u0443 \u043C\u043E\u0436\u043D\u043E \u0430\u0434\u0430\u043F\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u043E\u0434 \u0443\u0447\u0430\u0441\u0442\u043E\u043A: \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0432\u0445\u043E\u0434, \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u0435\u0440\u0440\u0430\u0441\u0443 \u0438\u043B\u0438 \u0433\u0430\u0440\u0430\u0436.")), /*#__PURE__*/React.createElement("aside", {
    style: {
      background: '#fff',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-card)',
      padding: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      position: 'sticky',
      top: 88
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    status: "progress",
    label: "\u0414\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u043A \u0441\u0442\u0440\u043E\u0438\u0442\u0435\u043B\u044C\u0441\u0442\u0432\u0443"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '400 14px var(--font-body)',
      color: 'var(--text-secondary)'
    }
  }, "\u0421\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C \u043F\u043E\u0434 \u043A\u043B\u044E\u0447"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '700 32px var(--font-display)',
      color: 'var(--text-heading)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, "\u043E\u0442 ", total.toLocaleString('ru-RU'), " \u20BD")), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--border-default)',
      paddingTop: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '600 15px var(--font-display)',
      color: 'var(--text-heading)'
    }
  }, "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430 \u043F\u0440\u043E\u0435\u043A\u0442\u0430"), opts.map(([n, v]) => /*#__PURE__*/React.createElement("div", {
    key: n,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Checkbox, {
    label: n,
    checked: !!sel[n],
    onChange: c => setSel({
      ...sel,
      [n]: c
    })
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '400 13px var(--font-body)',
      color: 'var(--text-muted)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, "+", v.toLocaleString('ru-RU'), " \u20BD")))), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    iconRight: "chevron-right",
    onClick: () => go('contractor')
  }, "\u041F\u043E\u0434\u043E\u0431\u0440\u0430\u0442\u044C \u043F\u043E\u0434\u0440\u044F\u0434\u0447\u0438\u043A\u0430"), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    variant: "secondary"
  }, "\u0417\u0430\u0434\u0430\u0442\u044C \u0432\u043E\u043F\u0440\u043E\u0441 \u0430\u0440\u0445\u0438\u0442\u0435\u043A\u0442\u043E\u0440\u0443"))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 48
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "\u041F\u043E\u0434\u0440\u044F\u0434\u0447\u0438\u043A\u0438 \u0434\u043B\u044F \u044D\u0442\u043E\u0433\u043E \u043F\u0440\u043E\u0435\u043A\u0442\u0430"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
      gap: 20
    }
  }, D.contractors.map(c => /*#__PURE__*/React.createElement(ContractorCard, _extends({
    key: c.id
  }, c, {
    onPrimary: () => go('contractor')
  }))))));
}
window.ProjectPage = ProjectPage;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/platform/ProjectPage.jsx", error: String((e && e.message) || e) }); }

// ui_kits/platform/Shared.jsx
try { (() => {
const NSX = window.DesignSystem_94a3e6;
const LOGO = '../../assets/logo-horizontal.svg';
const gridBg = {
  backgroundImage: 'linear-gradient(var(--grid-line) 1px,transparent 1px),linear-gradient(90deg,var(--grid-line) 1px,transparent 1px)',
  backgroundSize: '64px 64px'
};
function Nodes({
  nodes,
  cell = 64,
  dark
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, nodes.map(([x, y, c], i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      position: 'absolute',
      left: x * cell - 5,
      top: y * cell - 5,
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: `var(--ld-${c})`,
      opacity: dark ? .9 : 1
    }
  })));
}
function Container({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container)',
      margin: '0 auto',
      padding: '0 32px',
      ...style
    }
  }, children);
}
function SectionTitle({
  children,
  action
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      marginBottom: 24,
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: 'var(--text-h2)',
      color: 'var(--text-heading)',
      letterSpacing: 'var(--ls-heading)'
    }
  }, children), action);
}
function Footer() {
  const {
    Wordmark
  } = NSX;
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      borderTop: '1px solid var(--border-default)',
      padding: '32px 0',
      marginTop: 64
    }
  }, /*#__PURE__*/React.createElement(Container, {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 24,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    src: LOGO,
    height: 32
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-secondary-font)',
      color: 'var(--text-secondary)',
      flex: 1
    }
  }, "\u2014 \u0442\u0435\u0445\u043D\u043E\u043B\u043E\u0433\u0438\u0447\u043D\u0430\u044F \u043F\u043B\u0430\u0442\u0444\u043E\u0440\u043C\u0430 \u0434\u043B\u044F \u0432\u044B\u0431\u043E\u0440\u0430 \u043F\u0440\u043E\u0435\u043A\u0442\u043E\u0432, \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0438 \u043F\u043E\u0438\u0441\u043A\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043D\u044B\u0445 \u043F\u043E\u0434\u0440\u044F\u0434\u0447\u0438\u043A\u043E\u0432."), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-caption)',
      color: 'var(--text-muted)'
    }
  }, "\xA9 2026 \u041B\u043E\u0433\u0438\u043A\u0430 \u0414\u043E\u043C\u0430")));
}
Object.assign(window, {
  NSX,
  LOGO,
  gridBg,
  Nodes,
  Container,
  SectionTitle,
  Footer
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/platform/Shared.jsx", error: String((e && e.message) || e) }); }

// ui_kits/platform/data.js
try { (() => {
window.LD_DATA = {
  projects: [{
    id: 125,
    title: 'Проект 125',
    image: '../../assets/images/house-01.png',
    area: 120,
    rooms: 4,
    baths: 2,
    floors: 2,
    price: 4250000,
    badge: 'Популярный',
    type: 'Коттедж'
  }, {
    id: 87,
    title: 'Проект 87',
    image: '../../assets/images/house-02.png',
    area: 98,
    rooms: 3,
    baths: 1,
    floors: 2,
    price: 3150000,
    type: 'Коттедж'
  }, {
    id: 210,
    title: 'Проект 210',
    image: '../../assets/images/house-03.png',
    area: 156,
    rooms: 5,
    baths: 3,
    floors: 2,
    price: 5890000,
    badge: 'Новинка',
    type: 'Коттедж'
  }, {
    id: 120,
    title: 'Модерн 120',
    image: '../../assets/images/house-04.png',
    area: 120,
    rooms: 3,
    baths: 2,
    floors: 1,
    price: 5240000,
    badge: 'Премиум',
    type: 'Дуплекс'
  }, {
    id: 150,
    title: 'Оптимум 150',
    image: '../../assets/images/plan-01.png',
    area: 150,
    rooms: 4,
    baths: 2,
    floors: 2,
    price: 6890000,
    type: 'Коттедж'
  }, {
    id: 64,
    title: 'Проект 64',
    image: '../../assets/images/plan-02.png',
    area: 64,
    rooms: 2,
    baths: 1,
    floors: 1,
    price: 2390000,
    badge: 'Акция',
    type: 'Баня'
  }],
  contractors: [{
    id: 1,
    name: 'СтройЛогика',
    role: 'Строительство домов под ключ',
    rating: 4.9,
    reviews: 128,
    location: 'Москва и МО',
    verified: true,
    contract: true,
    experience: '14 лет'
  }, {
    id: 2,
    name: 'Иван Петров',
    role: 'Архитектор',
    avatar: '../../assets/images/avatar-architect.png',
    rating: 5.0,
    reviews: 74,
    location: 'Москва',
    experience: '12 лет',
    verified: true
  }, {
    id: 3,
    name: 'СтройПрофи',
    role: 'Строительство домов и коттеджей',
    rating: 4.8,
    reviews: 32,
    location: 'Москва и МО',
    verified: true,
    contract: true,
    experience: '9 лет'
  }],
  reviews: [{
    name: 'Анна К.',
    rating: 5,
    text: 'Построили дом по проекту 125 за 7 месяцев. Все этапы были прозрачны: смета, график, фотоотчёты.'
  }, {
    name: 'Сергей М.',
    rating: 4.7,
    text: 'Помогли адаптировать планировку под участок и добавили террасу без увеличения бюджета.'
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/platform/data.js", error: String((e && e.message) || e) }); }

__ds_ns.ContractorCard = __ds_scope.ContractorCard;

__ds_ns.ProjectCard = __ds_scope.ProjectCard;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Explication = __ds_scope.Explication;

__ds_ns.RoomTag = __ds_scope.RoomTag;

__ds_ns.TitleBlock = __ds_scope.TitleBlock;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Rating = __ds_scope.Rating;

__ds_ns.StatusDot = __ds_scope.StatusDot;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Radio = __ds_scope.Radio;

__ds_ns.RangeSlider = __ds_scope.RangeSlider;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Breadcrumbs = __ds_scope.Breadcrumbs;

__ds_ns.Wordmark = __ds_scope.Wordmark;

__ds_ns.Header = __ds_scope.Header;

__ds_ns.StepPath = __ds_scope.StepPath;

})();
