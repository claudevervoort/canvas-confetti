(function main(global, module, isWorker, workerSize) {
  let canUseWorker = !!(
    global.Worker &&
    global.Blob &&
    global.Promise &&
    global.OffscreenCanvas &&
    global.OffscreenCanvasRenderingContext2D &&
    global.HTMLCanvasElement &&
    global.HTMLCanvasElement.prototype.transferControlToOffscreen &&
    global.URL &&
    global.URL.createObjectURL);

  function noop() { }

  // create a promise if it exists, otherwise, just
  // call the function directly
  function promise(func) {
    let ModulePromise = module.exports.Promise;
    let Prom = ModulePromise !== void 0 ? ModulePromise : global.Promise;

    if (typeof Prom === 'function') {
      return new Prom(func);
    }

    func(noop, noop);

    return null;
  }

  const matmult = (m, v) => [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
  ]


  let starsByRot;


  function starsByRotation(size) {
    if (!starsByRot) {
      let spikes = 5;
      let outerRadius = size / 2;
      let innerRadius = outerRadius / 2;
      let x = 0, y = 0
      let vertices = [[x, y - outerRadius, 0]]
      let rot = Math.PI / 2 * 3;
      const step = Math.PI / spikes;
      for (let i = 0; i < spikes; i++) {
        x = Math.cos(rot) * outerRadius;
        y = Math.sin(rot) * outerRadius;
        vertices.push([x, y, 0])
        rot += step

        x = Math.cos(rot) * innerRadius;
        y = Math.sin(rot) * innerRadius;
        vertices.push([x, y, 0])
        rot += step
      }
      const starAtRotation = (angle) => vertices.map(v => matmult([[Math.cos(angle), 0, Math.sin(angle)], [0, 1, 0], [-Math.sin(angle), 0, Math.cos(angle)]], v));
      starsByRot = [...Array(180).keys()].map(s => starAtRotation(Math.PI * 2 / 180 * s))
    }
    return starsByRot;
  }

  let raf = (function () {
    let TIME = Math.floor(1000 / 60);
    let frame, cancel;
    let frames = {};
    let lastFrameTime = 0;

    if (typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function') {
      frame = function (cb) {
        let id = Math.random();

        frames[id] = requestAnimationFrame(function onFrame(time) {
          if (lastFrameTime === time || lastFrameTime + TIME - 1 < time) {
            lastFrameTime = time;
            delete frames[id];

            cb();
          } else {
            frames[id] = requestAnimationFrame(onFrame);
          }
        });

        return id;
      };
      cancel = function (id) {
        if (frames[id]) {
          cancelAnimationFrame(frames[id]);
        }
      };
    } else {
      frame = function (cb) {
        return setTimeout(cb, TIME);
      };
      cancel = function (timer) {
        return clearTimeout(timer);
      };
    }

    return { frame: frame, cancel: cancel };
  }());

  let getWorker = (function () {
    let worker;
    let prom;
    let resolves = {};

    function decorate(worker) {
      function execute(options, callback) {
        worker.postMessage({ options: options || {}, callback: callback });
      }
      worker.init = function initWorker(canvas) {
        let offscreen = canvas.transferControlToOffscreen();
        worker.postMessage({ canvas: offscreen }, [offscreen]);
      };

      worker.fire = function fireWorker(options, size, done) {
        if (prom) {
          execute(options, null);
          return prom;
        }

        let id = Math.random().toString(36).slice(2);

        prom = promise(function (resolve) {
          function workerDone(msg) {
            if (msg.data.callback !== id) {
              return;
            }

            delete resolves[id];
            worker.removeEventListener('message', workerDone);

            prom = null;
            done();
            resolve();
          }

          worker.addEventListener('message', workerDone);
          execute(options, id);

          resolves[id] = workerDone.bind(null, { data: { callback: id } });
        });

        return prom;
      };

      worker.reset = function resetWorker() {
        worker.postMessage({ reset: true });

        for (let id in resolves) {
          resolves[id]();
          delete resolves[id];
        }
      };
    }

    return function () {
      if (worker) {
        return worker;
      }

      if (!isWorker && canUseWorker) {
        let code = [
          'let CONFETTI, SIZE = {}, module = {};',
          '(' + main.toString() + ')(this, module, true, SIZE);',
          'onmessage = function(msg) {',
          '  if (msg.data.options) {',
          '    CONFETTI(msg.data.options).then(function () {',
          '      if (msg.data.callback) {',
          '        postMessage({ callback: msg.data.callback });',
          '      }',
          '    });',
          '  } else if (msg.data.reset) {',
          '    CONFETTI.reset();',
          '  } else if (msg.data.resize) {',
          '    SIZE.width = msg.data.resize.width;',
          '    SIZE.height = msg.data.resize.height;',
          '  } else if (msg.data.canvas) {',
          '    SIZE.width = msg.data.canvas.width;',
          '    SIZE.height = msg.data.canvas.height;',
          '    CONFETTI = module.exports.create(msg.data.canvas);',
          '  }',
          '}',
        ].join('\n');
        try {
          worker = new Worker(URL.createObjectURL(new Blob([code])));
        } catch (e) {
          // eslint-disable-next-line no-console
          typeof console !== undefined && typeof console.warn === 'function' ? console.warn('🎊 Could not load worker', e) : null;

          return null;
        }

        decorate(worker);
      }

      return worker;
    };
  })();

  let defaults = {
    particleCount: 50,
    angle: 90,
    spread: 45,
    startVelocity: 45,
    decay: 0.9,
    gravity: 1,
    drift: 0,
    ticks: 200,
    x: 0.5,
    y: 0.5,
    shapes: ['square', 'circle'],
    zIndex: 100,
    colors: [
      '#26ccff',
      '#a25afd',
      '#ff5e7e',
      '#88ff5a',
      '#fcff42',
      '#ffa62d',
      '#ff36ff'
    ],
    // probably should be true, but back-compat
    disableForReducedMotion: false,
    scalar: 1
  };

  function convert(val, transform) {
    return transform ? transform(val) : val;
  }

  function isOk(val) {
    return !(val === null || val === undefined);
  }

  function prop(options, name, transform) {
    return convert(
      options && isOk(options[name]) ? options[name] : defaults[name],
      transform
    );
  }

  function onlyPositiveInt(number) {
    return number < 0 ? 0 : Math.floor(number);
  }

  function randomInt(min, max) {
    // [min, max)
    return Math.floor(Math.random() * (max - min)) + min;
  }

  function toDecimal(str) {
    return parseInt(str, 16);
  }

  function colorsToRgb(colors) {
    return colors.map(hexToRgb);
  }

  function hexToRgb(str) {
    let val = String(str).replace(/[^0-9a-f]/gi, '');

    if (val.length < 6) {
      val = val[0] + val[0] + val[1] + val[1] + val[2] + val[2];
    }

    return {
      r: toDecimal(val.substring(0, 2)),
      g: toDecimal(val.substring(2, 4)),
      b: toDecimal(val.substring(4, 6))
    };
  }

  function getOrigin(options) {
    let origin = prop(options, 'origin', Object);
    origin.x = prop(origin, 'x', Number);
    origin.y = prop(origin, 'y', Number);

    return origin;
  }

  function setCanvasWindowSize(canvas) {
    canvas.width = document.documentElement.clientWidth;
    canvas.height = document.documentElement.clientHeight;
  }

  function setCanvasRectSize(canvas) {
    let rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  function getCanvas(zIndex) {
    let canvas = document.createElement('canvas');

    canvas.style.position = 'fixed';
    canvas.style.top = '0px';
    canvas.style.left = '0px';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = zIndex;

    return canvas;
  }

  function ellipse(context, x, y, radiusX, radiusY, rotation, startAngle, endAngle, antiClockwise) {
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.scale(radiusX, radiusY);
    context.arc(0, 0, 1, startAngle, endAngle, antiClockwise);
    context.restore();
  }

  function randomPhysics(opts) {
    let radAngle = opts.angle * (Math.PI / 180);
    let radSpread = opts.spread * (Math.PI / 180);

    let stars = opts.stars ? { ...opts.stars, rot: Math.floor(Math.random() * 180), velocity: opts.stars.velocity * (0.8 + 0.4 * Math.random()) } : null;
    let velocity = (opts.startVelocity * 0.5) + (Math.random() * opts.startVelocity);
    let angle2D = -radAngle + ((0.5 * radSpread) - (Math.random() * radSpread));

    return {
      x: opts.x,
      y: opts.y,
      wobble: Math.random() * 10,
      wobbleSpeed: Math.min(0.11, Math.random() * 0.1 + 0.05),
      velocity,
      angle2D,
      velocityVec: [velocity * Math.cos(angle2D), velocity * Math.sin(angle2D)],
      tiltAngle: (Math.random() * (0.75 - 0.25) + 0.25) * Math.PI,
      color: opts.color,
      shape: opts.shape,
      tick: 0,
      totalTicks: opts.ticks,
      decay: opts.decay,
      drift: opts.drift,
      random: Math.random() + 2,
      tiltSin: 0,
      tiltCos: 0,
      wobbleX: 0,
      wobbleY: 0,
      gravity: opts.gravity * 3,
      ovalScalar: 0.6,
      scalar: opts.scalar,
      stars,
      magnet: opts.magnet
    };
  }

  let logged = false

  const vecLength = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1]);
  const hslRgbaMap = {};
  const hslaToRgba = (h, s, l, a) => {
    const key = `${h}-${s}-${l}`;
    if (hslRgbaMap[key]) return hslRgbaMap[key]
    // Must be fractions of 1
    s /= 100.0;
    l /= 100.0;

    let c = (1 - Math.abs(2 * l - 1)) * s,
      x = c * (1 - Math.abs((h / 60) % 2 - 1)),
      m = l - c / 2.0,
      r = 0,
      g = 0,
      b = 0;

    if (0 <= h && h < 60) {
      r = c; g = x; b = 0;
    } else if (60 <= h && h < 120) {
      r = x; g = c; b = 0;
    } else if (120 <= h && h < 180) {
      r = 0; g = c; b = x;
    } else if (180 <= h && h < 240) {
      r = 0; g = x; b = c;
    } else if (240 <= h && h < 300) {
      r = x; g = 0; b = c;
    } else if (300 <= h && h < 360) {
      r = c; g = 0; b = x;
    }
    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);

    const val = "rgba(" + r + "," + g + "," + b + ", " + a + ")";
    hslRgbaMap[key] = val;
    return val;

  }

  function updateFetti(context, fetti) {
    if (!fetti.stars) {
      fetti.tiltAngle += 0.1;
      fetti.tiltSin = Math.sin(fetti.tiltAngle);
      fetti.tiltCos = Math.cos(fetti.tiltAngle);
    } else {
      fetti.stars.rot += fetti.stars.velocity * 2;
      fetti.stars.rot = fetti.stars.rot % 360;
    }
    if (fetti.magnet) {
      let magnetVector = [fetti.magnet.x - fetti.x, fetti.magnet.y - fetti.y]
      let magnetVectorLength = vecLength(magnetVector)
      if (magnetVectorLength < 0.1) magnetVectorLength = 0.1;
      magnetVector[0] = magnetVector[0] / magnetVectorLength
      magnetVector[1] = magnetVector[1] / magnetVectorLength
      if (!logged) console.log(fetti)
      fetti.velocityVec[0] += 1 * fetti.magnet.strength * magnetVector[0] - fetti.magnet.drag * fetti.velocityVec[0]
      fetti.velocityVec[1] += 1 * fetti.magnet.strength * magnetVector[1] + fetti.gravity - fetti.magnet.drag * fetti.velocityVec[1]
      fetti.x += fetti.velocityVec[0]
      fetti.y += fetti.velocityVec[1]
    } else {
      fetti.x += Math.cos(fetti.angle2D) * fetti.velocity + fetti.drift;
      fetti.y += Math.sin(fetti.angle2D) * fetti.velocity + fetti.gravity;
    }
    fetti.wobble += fetti.wobbleSpeed;
    fetti.velocity *= fetti.decay;
    fetti.random = Math.random() + 2;
    fetti.wobbleX = fetti.x + ((10 * fetti.scalar) * Math.cos(fetti.wobble));
    fetti.wobbleY = fetti.y + ((10 * fetti.scalar) * Math.sin(fetti.wobble));

    let progress = (fetti.tick++) / fetti.totalTicks;

    let x1 = fetti.x + (fetti.random * fetti.tiltCos);
    let y1 = fetti.y + (fetti.random * fetti.tiltSin);
    let x2 = fetti.wobbleX + (fetti.random * fetti.tiltCos);
    let y2 = fetti.wobbleY + (fetti.random * fetti.tiltSin);

    if (!logged) {
      console.log(fetti)
    }
    context.beginPath();

    if (fetti.stars) {
      context.fillStyle = hslaToRgba(fetti.stars.hsl[0], fetti.stars.hsl[1], fetti.stars.hsl[2] * (1.1 - fetti.stars.rot / 500), (1 - progress));
      let starVertices = starsByRotation(40)[Math.floor(fetti.stars.rot / 2)].map(v => [v[0] * fetti.stars.scale + fetti.x, v[1] * fetti.stars.scale + fetti.y]);
      context.moveTo(starVertices[0][0], starVertices[0][1])

      for (let i = 1; i < starVertices.length; i++) {
        context.lineTo(starVertices[i][0], starVertices[i][1])
      }
      //context.lineTo(cx, cy - outerRadius)
      context.closePath();
      context.fill();
      context.lineWidth = Math.ceil(fetti.stars.scale * 3);
      context.strokeStyle = hslaToRgba(fetti.stars.hsl[0], fetti.stars.hsl[1], fetti.stars.hsl[2] * (0.9 - fetti.stars.rot / 500), (1 - progress));
      context.stroke();
    } else if (fetti.shape === 'circle') {
      context.fillStyle = 'rgba(' + fetti.color.r + ', ' + fetti.color.g + ', ' + fetti.color.b + ', ' + (1 - progress) + ')';
      context.ellipse ?
        context.ellipse(fetti.x, fetti.y, Math.abs(x2 - x1) * fetti.ovalScalar, Math.abs(y2 - y1) * fetti.ovalScalar, Math.PI / 10 * fetti.wobble, 0, 2 * Math.PI) :
        ellipse(context, fetti.x, fetti.y, Math.abs(x2 - x1) * fetti.ovalScalar, Math.abs(y2 - y1) * fetti.ovalScalar, Math.PI / 10 * fetti.wobble, 0, 2 * Math.PI);
      context.closePath();
      context.fill();
      console.log('333')
    } else {
      context.fillStyle = 'rgba(' + fetti.color.r + ', ' + fetti.color.g + ', ' + fetti.color.b + ', ' + (1 - progress) + ')';
      context.moveTo(Math.floor(fetti.x), Math.floor(fetti.y));
      context.lineTo(Math.floor(fetti.wobbleX), Math.floor(y1));
      context.lineTo(Math.floor(x2), Math.floor(y2));
      context.lineTo(Math.floor(x1), Math.floor(fetti.wobbleY));
      context.closePath();
      context.fill();
    }
    logged = true


    return fetti.tick < fetti.totalTicks;
  }

  function animate(canvas, fettis, resizer, size, done) {
    let animatingFettis = fettis.slice();
    let context = canvas.getContext('2d');
    let animationFrame;
    let destroy;

    let prom = promise(function (resolve) {
      function onDone() {
        animationFrame = destroy = null;

        context.clearRect(0, 0, size.width, size.height);

        done();
        resolve();
      }

      function update() {
        if (isWorker && !(size.width === workerSize.width && size.height === workerSize.height)) {
          size.width = canvas.width = workerSize.width;
          size.height = canvas.height = workerSize.height;
        }

        if (!size.width && !size.height) {
          resizer(canvas);
          size.width = canvas.width;
          size.height = canvas.height;
        }

        context.clearRect(0, 0, size.width, size.height);

        animatingFettis = animatingFettis.filter(function (fetti) {
          return updateFetti(context, fetti);
        });

        if (animatingFettis.length) {
          animationFrame = raf.frame(update);
        } else {
          onDone();
        }
      }

      animationFrame = raf.frame(update);
      destroy = onDone;
    });

    return {
      addFettis: function (fettis) {
        animatingFettis = animatingFettis.concat(fettis);

        return prom;
      },
      canvas: canvas,
      promise: prom,
      reset: function () {
        if (animationFrame) {
          raf.cancel(animationFrame);
        }

        if (destroy) {
          destroy();
        }
      }
    };
  }

  function confettiCannon(canvas, globalOpts) {
    let isLibCanvas = !canvas;
    let allowResize = !!prop(globalOpts || {}, 'resize');
    let globalDisableForReducedMotion = prop(globalOpts, 'disableForReducedMotion', Boolean);
    let shouldUseWorker = canUseWorker && !!prop(globalOpts || {}, 'useWorker');
    let worker = shouldUseWorker ? getWorker() : null;
    let resizer = isLibCanvas ? setCanvasWindowSize : setCanvasRectSize;
    let initialized = (canvas && worker) ? !!canvas.__confetti_initialized : false;
    let preferLessMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion)').matches;
    let animationObj;

    function fireLocal(options, size, done) {
      let particleCount = prop(options, 'particleCount', onlyPositiveInt);
      let angle = prop(options, 'angle', Number);
      let spread = prop(options, 'spread', Number);
      let startVelocity = prop(options, 'startVelocity', Number);
      let decay = prop(options, 'decay', Number);
      let gravity = prop(options, 'gravity', Number);
      let drift = prop(options, 'drift', Number);
      let colors = prop(options, 'colors', colorsToRgb);
      let ticks = prop(options, 'ticks', Number);
      let shapes = prop(options, 'shapes');
      let scalar = prop(options, 'scalar');
      let origin = getOrigin(options);
      const stars = options.stars ? { scale: 1, velocity: 1, hsl: [49, 100, 61], ...options.stars } : null;
      const magnet = options.magnet ? { drag: 0.05, strength: 1, ...options.magnet } : null;
      let temp = particleCount;
      let fettis = [];
      let startX = 0, startY = 0, startSpreadX = 0, startSpreadY = 0;
      if (options.originRect) {
        const source = options.originRect;
        startSpreadX = source.width;
        startSpreadY = source.height;
        startX = source.x;
        startY = source.y;
      } else {
        startX = canvas.width * origin.x;
        startY = canvas.height * origin.y;
      }
      while (temp--) {
        fettis.push(
          randomPhysics({
            x: startX + randomInt(0, startSpreadX),
            y: startY + randomInt(0, startSpreadY),
            angle: angle,
            spread: spread,
            startVelocity: startVelocity,
            color: colors[temp % colors.length],
            shape: shapes[randomInt(0, shapes.length)],
            ticks: ticks,
            decay: decay,
            gravity: gravity,
            drift: drift,
            scalar: scalar,
            stars,
            magnet
          })
        );
      }

      // if we have a previous canvas already animating,
      // add to it
      if (animationObj) {
        return animationObj.addFettis(fettis);
      }

      animationObj = animate(canvas, fettis, resizer, size, done);

      return animationObj.promise;
    }

    function fire(options) {
      let disableForReducedMotion = globalDisableForReducedMotion || prop(options, 'disableForReducedMotion', Boolean);
      let zIndex = prop(options, 'zIndex', Number);

      if (disableForReducedMotion && preferLessMotion) {
        return promise(function (resolve) {
          resolve();
        });
      }

      if (isLibCanvas && animationObj) {
        // use existing canvas from in-progress animation
        canvas = animationObj.canvas;
      } else if (isLibCanvas && !canvas) {
        // create and initialize a new canvas
        canvas = getCanvas(zIndex);
        document.body.appendChild(canvas);
      }

      if (allowResize && !initialized) {
        // initialize the size of a user-supplied canvas
        resizer(canvas);
      }

      let size = {
        width: canvas.width,
        height: canvas.height
      };

      if (worker && !initialized) {
        worker.init(canvas);
      }

      initialized = true;

      if (worker) {
        canvas.__confetti_initialized = true;
      }

      function onResize() {
        if (worker) {
          // TODO this really shouldn't be immediate, because it is expensive
          let obj = {
            getBoundingClientRect: function () {
              if (!isLibCanvas) {
                return canvas.getBoundingClientRect();
              }
            }
          };

          resizer(obj);

          worker.postMessage({
            resize: {
              width: obj.width,
              height: obj.height
            }
          });
          return;
        }

        // don't actually query the size here, since this
        // can execute frequently and rapidly
        size.width = size.height = null;
      }

      function done() {
        animationObj = null;

        if (allowResize) {
          global.removeEventListener('resize', onResize);
        }

        if (isLibCanvas && canvas) {
          document.body.removeChild(canvas);
          canvas = null;
          initialized = false;
        }
      }

      if (allowResize) {
        global.addEventListener('resize', onResize, false);
      }

      if (worker) {
        return worker.fire(options, size, done);
      }

      return fireLocal(options, size, done);
    }

    fire.reset = function () {
      if (worker) {
        worker.reset();
      }

      if (animationObj) {
        animationObj.reset();
      }
    };

    return fire;
  }

  module.exports = confettiCannon(null, { useWorker: true, resize: true });
  module.exports.create = confettiCannon;
}((function () {
  if (typeof window !== 'undefined') {
    return window;
  }

  if (typeof self !== 'undefined') {
    return self;
  }

  return this || {};
})(), module, false));
