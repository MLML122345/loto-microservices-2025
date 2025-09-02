var http = require('http');

// Configuration
var BASE_URL = 'http://localhost:3000/api';
var adminToken = '';
var playerToken = '';
var drawId = '';

// Colors for output
var colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  reset: '\x1b[0m'
};

// HTTP request helper with better error handling
function makeRequest(method, path, data, token, callback) {
  var postData = data ? JSON.stringify(data) : '';
  var url = path.startsWith('http') ? path : BASE_URL + path;
  var urlParts = url.replace('http://', '').split('/');
  var host = urlParts[0].split(':')[0];
  var port = urlParts[0].split(':')[1] || 80;
  var urlPath = '/' + urlParts.slice(1).join('/');

  console.log(colors.yellow + 'Request: ' + method + ' ' + url + colors.reset);
  if (data) console.log(colors.yellow + 'Body: ' + JSON.stringify(data) + colors.reset);

  var options = {
    hostname: host,
    port: port,
    path: urlPath,
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  if (token) {
    options.headers['Authorization'] = 'Bearer ' + token;
  }

  var req = http.request(options, function(res) {
    var body = '';
    res.on('data', function(chunk) {
      body += chunk;
    });
    res.on('end', function() {
      console.log(colors.cyan + 'Response Status: ' + res.statusCode + colors.reset);
      console.log(colors.cyan + 'Response Body: ' + body + colors.reset);
      
      var response = {
        status: res.statusCode,
        data: null
      };
      try {
        response.data = body ? JSON.parse(body) : null;
      } catch (e) {
        response.data = body;
      }
      callback(null, response);
    });
  });

  req.on('error', function(e) {
    console.log(colors.red + 'Request Error: ' + e.message + colors.reset);
    callback(e, null);
  });

  if (postData) {
    req.write(postData);
  }
  req.end();
}

// Simple test sequence
console.log(colors.yellow + '\n=== LOTTERY SYSTEM DEBUG TEST ===' + colors.reset);

// Test 1: Check health
console.log(colors.cyan + '\n1. Testing Gateway Health' + colors.reset);
makeRequest('GET', 'http://localhost:3000/health', null, null, function(err, res) {
  if (err || !res) {
    console.log(colors.red + 'Gateway health check failed!' + colors.reset);
    return;
  }
  
  // Test 2: Admin login
  console.log(colors.cyan + '\n2. Admin Login' + colors.reset);
  makeRequest('POST', '/auth/login', {
    email: 'admin@loto.com',
    password: 'admin123'
  }, null, function(err, res) {
    if (res && res.data && res.data.token) {
      adminToken = res.data.token;
      console.log(colors.green + 'Admin token received: ' + adminToken.substring(0, 20) + '...' + colors.reset);
      
      // Test 3: Create a draw
      var futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      var drawDate = futureDate.toISOString().split('T')[0];
      
      console.log(colors.cyan + '\n3. Create Draw for date: ' + drawDate + colors.reset);
      makeRequest('POST', '/lottery/draws', {
        draw_date: drawDate,
        prize_amount: 10000
      }, adminToken, function(err, res) {
        if (res && res.data && res.data.id) {
          drawId = res.data.id;
          console.log(colors.green + 'Draw created with ID: ' + drawId + colors.reset);
          
          // Test 4: Register user
          var userEmail = 'test' + Date.now() + '@example.com';
          console.log(colors.cyan + '\n4. Register User: ' + userEmail + colors.reset);
          makeRequest('POST', '/auth/register', {
            email: userEmail,
            password: 'password123'
          }, null, function(err, res) {
            if (res && res.status === 201) {
              console.log(colors.green + 'User registered successfully' + colors.reset);
              
              // Test 5: Login as user
              console.log(colors.cyan + '\n5. Login as User' + colors.reset);
              makeRequest('POST', '/auth/login', {
                email: userEmail,
                password: 'password123'
              }, null, function(err, res) {
                if (res && res.data && res.data.token) {
                  playerToken = res.data.token;
                  console.log(colors.green + 'User token received' + colors.reset);
                  
                  // Test 6: Place bet
                  console.log(colors.cyan + '\n6. Place Bet on Draw ID: ' + drawId + colors.reset);
                  makeRequest('POST', '/lottery/bets', {
                    draw_id: drawId,
                    numbers: [5, 12, 23, 34, 45],
                    complementary_number: 7
                  }, playerToken, function(err, res) {
                    if (res && res.status === 201) {
                      console.log(colors.green + 'Bet placed successfully!' + colors.reset);
                      
                      // Test 7: Get draws
                      console.log(colors.cyan + '\n7. Get All Draws' + colors.reset);
                      makeRequest('GET', '/lottery/draws', null, null, function(err, res) {
                        if (res && res.data) {
                          console.log(colors.green + 'Found ' + res.data.length + ' draws' + colors.reset);
                          
                          console.log(colors.green + '\n✅ ALL BASIC TESTS PASSED!' + colors.reset);
                        }
                      });
                    }
                  });
                }
              });
            }
          });
        } else {
          console.log(colors.red + 'Failed to create draw. It might already exist for this date.' + colors.reset);
        }
      });
    } else {
      console.log(colors.red + 'Admin login failed!' + colors.reset);
    }
  });
});