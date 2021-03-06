var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var mysql = require('mysql');
var request = require('request');
var fs = require('fs');

var connection;
var options = {};

var lastCheck = 0;
var lastResult;

// get the options from `options.json`
try {
    options = JSON.parse(fs.readFileSync('options.json'));
} catch (err) {
    throw err;
}

// if we have an environmental variable, use it
var mysqlHost = process.env.MYSQL_HOST || options.mysql.host;
var mysqlUser = process.env.MYSQL_USER || options.mysql.user;
var mysqlPort = process.env.MYSQL_PORT || options.mysql.port;
var mysqlPass = process.env.MYSQL_PASS || options.mysql.password;
var mysqlDB = process.env.MYSQL_DB || options.mysql.database;

var db_config = {
    host: mysqlHost,
    user: mysqlUser,
    port: mysqlPort,
    password: mysqlPass,
    database: mysqlDB,
    charset: 'latin1_swedish_ci'
};

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

var port = process.env.PORT || 8080;
var router = express.Router();

function initSQL() {
    connection = mysql.createConnection(db_config);

    connection.connect(function(err) {
        // if there's an error, try again in 2 seconds
        if (err) {
            setTimeout(initSQL, 2000);
        } else {
            console.log('Connected to MySQL.');
        }
    });

    connection.on('error', function(err) {
        console.log('MySQL error: ' + err);
        
        // reconnect to mysql on `PROTOCOL_CONNECTION_LOST`
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            initSQL();
        } else {
            throw err;
        }
    });
    
    // keep the connection alive
    setInterval(function() {
        connection.query('SELECT 1');
    }, 5000);
}

// initiate mysql
initSQL();

////////////////////
// On GET request //
////////////////////
router.get('/', function(req, res) {
    var query = res.req.query;
    
    if (query.key === undefined || query.item === undefined) {
        res.json({ success: false, error: options.errors.missing_params });
        return;
    }
    
    // check if the key exists
    connection.query('SELECT `premium` FROM `keys` WHERE `key`=?', [query.key], function(err, row) {
        if (err) {
            throw err;
        }
        
        var isPremium = row[0].premium;
        
        if (row.length > 0) {
            connection.query('SELECT `item`,`current_price`,`avg_week_price`,`avg_month_price`,`lastupdate` FROM `prices` WHERE `item`=?', [query.item], function(err, row) {
                if (err) {
                    throw err;
                }
                
                if (row.length > 0) {
                    var current_price, avg_week_price, avg_month_price;
                
                    if (row[0].current_price !== undefined && row[0].avg_week_price !== undefined && row[0].avg_month_price !== undefined) {
                        current_price = row[0].current_price;
                        avg_week_price = row[0].avg_week_price;
                        avg_month_price = row[0].avg_month_price;
                    }
                    
                    if (current_price !== undefined && avg_week_price !== undefined && avg_month_price !== undefined) {
                        res.json({ success: true, current_price: current_price, avg_week_price: avg_week_price, avg_month_price: avg_month_price, lastupdate: row[0].lastupdate });
                    }
                } else {
                    // if the item is not found in our database, get the data from the market
                    request('http://steamcommunity.com/market/priceoverview/?country=US&currency=1&appid=730&market_hash_name=' + encodeURIComponent(query.item), function(error, response, body) {
                        var json = '';
                        
                        try {
                            json = JSON.parse(body);
                        } catch (e) {
                            res.json({ success: false, error: options.errors.unknown_item });
                            return;
                        }
                        
                        var current = Math.floor(Date.now() / 1000);
                        if (!error && response.statusCode === 200 && json.lowest_price !== undefined && json.median_price !== undefined) {
                            connection.query('INSERT INTO `prices` (`item`, `current_price`, `avg_month_price`, `avg_week_price`, `lastupdate`) VALUES (?, \'' + json.lowest_price.replace('$', '') + '\', \'' + json.median_price.replace('$', '') + '\', \'' + json.median_price.replace('$', '') + '\', ' + current + ')', [query.item]);
                            connection.query('INSERT INTO `price_history` (`item`, `price`, `time`) VALUES (?, \'' + json.median_price.replace('$', '') + '\', ' + current + ')', [query.item]);
                            
                            connection.query('SELECT `item`,`current_price`,`avg_week_price`,`avg_month_price`,`lastupdate` FROM `prices` WHERE `item`=?', [query.item], function(err, row) {
                                if (err) {
                                    throw err;
                                }
                                
                                if (row.length > 0) {
                                    res.json({ success: true, current_price: row[0].current_price, avg_week_price: row[0].avg_week_price, avg_month_price: row[0].avg_month_price, lastupdate: row[0].lastupdate });
                                } else {
                                    res.json({ success: false, error: options.errors.unknown_item });
                                }
                            });
                        } else {
                            res.json({ success: false, error: options.errors.unknown_item });
                        }
                    });
                }
            });
        } else {
            res.json({ success: false, error: options.errors.invalid_key });
        }
    });
});

router.get('/all', function(req, res) {
    var query = res.req.query;
    
    if (query.key === undefined) {
        res.json({ success: false, error: options.errors.missing_params });
        return;
    }
    
    // check if the key exists
    connection.query('SELECT `premium` FROM `keys` WHERE `key`=?', [query.key], function(err, row) {
        if (err) {
            throw err;
        }
        
        var isPremium = row[0].premium;
        
        if (row.length > 0) {
            if (isPremium) {
                connection.query('SELECT `item`,`current_price` FROM `prices` ORDER BY `item` ASC', function(err, row) {
                    if (err) {
                        throw err;
                    }
                    
                    var output = {};
                    
                    row.forEach(function(item) {
                        output[item.item] = {
                            current_price: item.current_price,
                        };
                    });
                    
                    res.json({ success: true, items: output });
                });
            } else {
                res.json({ success: false, error: options.errors.not_premium });
            }
        } else {
            res.json({ success: false, error: options.errors.invalid_key });
        }
    });
});

router.get('/backpacktf', function(req, res) {
    var query = res.req.query;
    
    if (query.key === undefined) {
        res.json({ success: false, error: options.errors.missing_params });
        return;
    }
    
    // check if the key exists
    connection.query('SELECT `premium` FROM `keys` WHERE `key`=?', [query.key], function(err, row) {
        if (err) {
            throw err;
        }
        
        var isPremium = row[0].premium;
        
        if (row.length > 0) {
            if (isPremium) {
                if (Math.floor(Date.now() / 1000) - lastCheck >= 120) {
                    request('http://backpack.tf/api/IGetMarketPrices/v1/?key=' + options.backpacktf_key + '&appid=730', function(err, response, body) {
                        if (err) {
                            console.log("Error receiving backpack.tf prices");
                            res.json({ success: true, items: lastResult });
                            return;
                        }
                        
                        try {
                            body = JSON.parse(body);
                        } catch (e) {
                            console.log("Error parsing JSON from backpack.tf");
                            res.json({ success: true, items: lastResult });
                            return;
                        }
                        
                        if (body.response.success) {
                            res.json({ success: true, items: body.response.items });
                            lastResult = body.response.items;
                        } else {
                            res.json({ success: true, items: lastResult });
                        }
                    });
                }
            } else {
                res.json({ success: false, error: options.errors.not_premium });
            }
        } else {
            res.json({ success: false, error: options.errors.invalid_key });
        }
    });
});

// register the router
app.use('/api', router);

// start the server
app.listen(port);
console.log('Magic happens on port ' + port);
