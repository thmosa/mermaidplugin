// Export av förhandsvisningen: hela diagrammet som fristående SVG-fil eller som PNG.
// Laddas som vanligt skript i webviewen (window.Export). Rör inte förhandsvisningens SVG.
(function (root) {
  'use strict';

  const Export = {};
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';

  /**
   * SVG-filens text: en kopia av `svg` med hela diagrammet (`base` = {x,y,w,h}) i naturlig
   * storlek, utan zoom och markering, och med `background` som bakgrundsfärg.
   */
  Export.svgText = (svg, base, background) => {
    const copy = svg.cloneNode(true);
    copy.querySelectorAll('.mm-selected').forEach(e => e.classList.remove('mm-selected'));
    copy.querySelectorAll('.mm-toggle').forEach(e => e.remove());
    copy.setAttribute('viewBox', `${base.x} ${base.y} ${base.w} ${base.h}`);
    copy.setAttribute('width', String(base.w));
    copy.setAttribute('height', String(base.h));
    copy.setAttribute('xmlns', SVG_NS);
    copy.setAttribute('xmlns:xlink', XLINK_NS);
    if (background) copy.setAttribute('style', `background-color: ${background}`);
    else copy.removeAttribute('style');
    // XMLSerializer ger giltig XML även för HTML-etiketter (<br> blir <br/>).
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(copy);
  };

  /** PNG som data-URL: SVG-filen ritad i `scale` gånger naturlig storlek på `background`. */
  Export.pngDataUrl = async (svgText, base, scale, background) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(base.w * scale);
    canvas.height = Math.ceil(base.h * scale);
    const ctx = canvas.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Export;
  else root.Export = Export;
})(this);
