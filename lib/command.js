var nopt = require('nopt')
, path = require('path')
, redis = require('redis')
, URL = require('url')

var parsers = require('./parser')

module.exports = nice(command) // bro

var options = {
  'address': String
  , 'channel': String
  , 'mimetype': String
  , 'help': Boolean
  , 'readable': Boolean
  , 'command': String
}

var shorthand = {
  'addr': ['--address']
  , 'a': ['--address']
  , 'c': ['--channel']
  , 'm': ['--mimetype']
  , 'h': ['--help']
  , '?': ['--help']
  , 'r': ['--readable']
  , 'C': ['--command']
}

var defaults = {
  'address': 'localhost:6379'
  , 'channel': null
  , 'mimetype': 'text/plain'
  , 'help': false
  , 'readable': false
  , 'command': 'publish'
}

var help = function(){/*
redispump

pipe parsed stdout data to a redis channel
because of win.

  --address localhost:port      sets the address and port to connect to redis on
  --addr
  -a

  --channel                     sets the channel to output redis data to
  -c

  --command                     sets the redis command to use (publish|rpush)
  -C

  --mimetype text/plain         sets the mimetype mode to parse stdout data with. 
  -m                            

  --readable                    puts redispump into readable mode -- suitable for
  -r                            piping messages on a channel out of redis and into
                                other commands.

  available mimetypes are:
  * text/plain        - line-by-line output
  * application/json  - emits each top level JSON object
*/}.toString().slice('function()/*'.length+2, -3)

function command() {
  var parsed = nopt(options, shorthand)
  , values = {}
  , client
  , parser
  , value

  if(parsed.help)
    return console.error(help)

  Object.keys(options).forEach(function(key) {
    value = parsed[key] || defaults[key]

    if(value === null || value === undefined) {
      throw new Error(key+' is a required argument.')
    }

    values[key] = value
  })

  if(!parsers[values.mimetype]) {
    throw new Error(values.mimetype+' is not a valid mimetype\n'+help) 
  }

  values.address = URL.parse(
    !~values.address.indexOf('://') ?
    'redis://'+values.address :
    values.address
    )

  client = redis.createClient(
    +values.address.port || 6379
    , values.address.hostname,
    { retry_max_delay: 5000,
      persist_offline_queue: true }
    )

  client.on('error', function(err){
    if (err) console.log("error: " + err)
  })

  parser = new parsers[values.mimetype]()

  if(values.readable) {
    client.subscribe(values.channel)
    client.on('message', function(channel, message) {
      if(channel === values.channel)
        process.stdout.write(message)
    })
  } else {

    process.stdin
    .pipe(parser)
    .on('data', pump_data)
    .on('end', function() {
        // wait until we've emptied our commands.
        // "drain" emits several times along the way,
        // so this seems like the safest way to go about it.
        var interval = setInterval(function() {
          if(!client.command_queue.length && !client.offline_queue.length) { 
            clearInterval(interval)
            client.end()
          }
        }, 0)
      })

    process.stdin.setEncoding('utf8')

    function pump_data(data) {
      if(typeof data !== 'string')
        data = JSON.stringify(data)

      if(values.command == 'rpush') {
        client.rpush(values.channel, data);
      } else  {
        client.publish(values.channel, data);
      }
    }
  }
}

function nice(fn) {
  return function() {
    try {
      fn()
    } catch(e) {
      console.error(e.message)
        process.exit(1)
      }
    }
  }
