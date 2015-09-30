var request = require('request');
var mysql   = require('mysql');
var fs      = require('fs');

var options = {};

try {
    options = JSON.parse(fs.readFileSync('options.json'));
} catch (err) {
    throw err;
}

var db_config = {
    host: options.mysql.host,
    user: options.mysql.user,
    port: options.mysql.port,
    password: options.mysql.password,
    database: options.mysql.database,
    charset: 'latin1_swedish_ci'
};

var connection;

function initSQL() {
    connection = mysql.createConnection(db_config);

    connection.connect(function(err) {
        if (err) {
            setTimeout(initSQL, 2000);
        } else {
            console.log('Connected to MySQL.');
        }
    });

    connection.on('error', function(err) {
        console.log('MySQL error: ' + err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            initSQL();
        } else {
            throw err;
        }
    });
}

initSQL();

setTimeout(refreshPrices, 1000);

function refreshPrices() {
    var current = Math.floor(Date.now() / 1000);
    connection.query('SELECT * FROM `prices` WHERE `lastupdate`<' + (parseInt(current) - options.update_time).toString(), function(err, row) {
        if (err) {
            throw err;
        }
        
        if (row.length > 0) {
            row.forEach(function(item) {
                connection.query('UPDATE `prices` SET `lastupdate`=' + current + ' WHERE `item`=\'' + item.item + '\'');
                request('http://steamcommunity.com/market/priceoverview/?country=US&currency=1&appid=730&market_hash_name=' + encodeURIComponent(item.item), function (error, response, body) {
                    var json = JSON.parse(body);
                    if (!error && response.statusCode === 200 && json.lowest_price !== undefined) {
                        connection.query('UPDATE `prices` SET `current_price`=\'' + json.lowest_price.replace('$', '') + '\' WHERE `item`=\'' + item.item + '\'');
                        console.log('Succesfully updated ' + item.item + ' w/ ' + json.lowest_price);
                    } else {
                        console.log('An error occured receiving price for item: ' + item.item);
                    }
                });
            });
        }
    });
}

setInterval(refreshPrices, options.refresh_interval);