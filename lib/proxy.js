/*global require, exports */

var http = require('http');
var _ = require('underscore');
var util = require('util');
var handleLocal = require('./handleLocal');
var allVerbs = [ 'GET', 'POST', 'PUT', 'DELETE', 'PATCH' ];

/**
 * ProxyServer
 * Routes all connections to another address
 * Exceptions can be aded to serve content locally
 *
 * @api public
 */
var ProxyServer = exports.ProxyServer = function(options) {
  
  if('string' === typeof options) {
    if(options.indexOf(':') > -1) {
      var tokens = options.split(':');
      options = { host: tokens[0], port: parseInt(tokens[1]) };
    } else {
      options = { host: options };
    }
  } else {
    options = options || {};
  }

  this.options = {
    host: options.host,
    port: options.port || 80,
    path: options.path || '',
    headers: options.headers || {},
    methods: 'GET',
    supressQuery: false,
    logRequests: options.logRequests || true
  };

  this.host = options.host;

  this.handlers = [];

  this.interceptors = [];

  this.options.headers['user-agent'] = options.userAgent || this.options.headers['user-agent'];

  var _this = this;

  this.server = http.createServer(function(req, res) {

    for (var property in _this.interceptors) {
      if (_this.interceptors.hasOwnProperty(property)) {
          var interceptor = _this.interceptors[property];
          var matches = req.url.match(interceptor.regex);
          if (matches) {
            if (interceptor.callback(matches, req, res)) {
              return;
            }
          }
      }
    }

    // if we got here then we did not have an interceptor
    if(!_this.customHandler(req, res) && !_this.handleWithLocal(req, res))
        _this.passThrough(req, res);
    });

  };

/**
 * listen
 * start listening on a specific port
 *
 * @api public
 */
ProxyServer.prototype.listen = function(port, callback) {
  this.port = port;
  if(callback)
    this.server.listen(port, callback);
  else
    this.server.listen(port);
};

/**
 * handleWithLocal
 * if a file is found at local/[requested path], this handler will reply yes
 * and then pass the contents of that file as the response
 *
 * @api private
 */
ProxyServer.prototype.handleWithLocal = function(req, res) {
  return handleLocal.pipe(req, res, this.options);
};

/**
 * customHandler
 * if a handler is found at local/[requested path], this handler will reply yes
 * and then delegate answering the response to that handler
 *
 * @api private
 */
ProxyServer.prototype.customHandler = function(req, res) {
  var handlerObject = this.handlers[req.url];
  if(handlerObject) {
    if(!req.method)
      req.method = 'GET';

    var handler = handlerObject[req.method];

    if(handler) {
      handler(req, res);
      return true;
    }

    return false;
  }
  return false;
};

/**
 * passThrough
 * passes the request to the registered remote server
 *
 * @api private
 */
ProxyServer.prototype.passThrough = function(req, res, onResponse) {

  if (this.options.logRequests) {
    console.log(req.method, req.headers['host'], req.url);
  }

  // make a copy of options
  var options = _.clone(this.options);
  options.headers = _.clone(this.options.headers);
  options.method = req.method;

  _.each(_.keys(req.headers), function(key) {
    if('Access-Control-Request-Method' === key)
      options.method = req.headers[key];
    else if('host' !== key)
      options.headers[key] = req.headers[key];
  });

  options.path += req.url;

  var request = http.request(options, function(response) {
    res.writeHead(response.statusCode, response.headers);

    var body = '';

    response.on('data', function(chunk) {
      body += chunk;
      res.write(chunk);
    });

    response.on('end', function() {
      res.end();
      if (onResponse) {
        onResponse(body);
      }
    });

    response.on('close', function(err) {
      res.end(err);
    });
  });
  request.on('error', function(err) {
    res.end(util.inspect(err));
  });

  req.on('data', function(chunk) {
    request.write(chunk);
  });

  req.on('end', function() {
    request.end();
  });

  return true;
};

/**
 * addHandler
 * add a handler for a specific route
 *
 * @api private
 */
ProxyServer.prototype.intercept = function(urlRegex, callback) {
  if (callback) {
    this.interceptors[urlRegex] = {
      regex: urlRegex,
      callback: callback
    };
  } else {
    delete this.interceptors[urlRegex];
  }
};

/**
 * addHandler
 * add a handler for a specific route
 *
 * @api private
 */
ProxyServer.prototype.addHandler = function() {

  var args = Array.prototype.slice.call(arguments);
  
  // request url
  var path = args.shift();

  // custom handler for request
  var handler = args.pop();

  // value of verbs
  var verbs = (args.length) ? args.shift() : allVerbs;
  
  // create verbs array
  if('string' == typeof verbs) {
    verbs = verbs.indexOf(',') > -1
      ? verbs.toUpperCase().split(',')
      : [ verbs.toUpperCase() ];
  }

  verbs = verbs.sort();
  
  // set handlers on handler object
  var handlerObject = this.handlers[path] || {};
  verbs.forEach(function(verb) {
    handlerObject[verb] = handler;
  });

  this.handlers[path] = handlerObject;

  return this;
};

/**
 * removeHandler
 * remove a handler for a specific route
 *
 * @api private
 */
ProxyServer.prototype.removeHandler = function() {

  var args = Array.prototype.slice.call(arguments);
  
  // request url
  var path = args.shift();

  // get handler object for path
  if(!this.handlers[path])
    return this;

  // value of verbs
  var verbs = (args.length) ? args.shift() : null;

  if(!verbs) {
    delete this.handlers[path];
  } else {
    var handlerObject = this.handlers[path];
    if('string' == typeof verbs)
      verbs = (verbs.indexOf(',') > -1)
        ? verbs.toUpperCase().split(',')
        : [ verbs.toUpperCase() ];

    verbs = verbs.sort();

    verbs.forEach(function(verb) {
      delete handlerObject[verb];
    });
  }

  return this;
};


exports.createServer = function (options) {

  return new ProxyServer(options);

};