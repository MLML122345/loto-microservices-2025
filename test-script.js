var http = require('http');

// Configuration
var BASE_URL = 'http://localhost:3000/api';
var adminToken = '';
var playerToken = '';
var drawId = '';
var testEmail = 'test' + Date.now() + '@example.com';

// Test results tracking
var totalTests = 0;
var passedTests = 0;
var failedTests = 0;

// Colors for output
var colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  reset: '\x1b[0m'
};

// Utility function to print test results
function printResult(testName, passed, error) {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(colors.green + '✅ ' + testName + colors.reset);
  } else {
    failedTests++;
    console.log(colors.red + '❌ ' + testName + colors.reset);
    if (error) {
      console.log(colors.yellow + '   Error: ' + error + colors.reset);
    }
  }
}

// HTTP request helper
function makeRequest(method, path, data, token, callback) {
  var postData = data ? JSON.stringify(data) : '';
  var url = path.startsWith('http') ? path : BASE_URL + path;
  var urlParts = url.replace('http://', '').split('/');
  var host = urlParts[0].split(':')[0];
  var port = urlParts[0].split(':')[1] || 80;
  var urlPath = '/' + urlParts.slice(1).join('/');

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
    callback(e, null);
  });

  if (postData) {
    req.write(postData);
  }
  req.end();
}

// Test functions with CORRECTED expectations
function testPublicEndpoints(callback) {
  console.log(colors.cyan + '\n📋 Testing Public Endpoints' + colors.reset);
  
  makeRequest('GET', '/lottery/draws', null, null, function(err, res) {
    printResult('GET /lottery/draws (public)', res && res.status === 200);
    callback();
  });
}

function testAuthentication(callback) {
  console.log(colors.cyan + '\n🔐 Testing Authentication' + colors.reset);
  
  // Admin login
  makeRequest('POST', '/auth/login', {
    email: 'admin@loto.com',
    password: 'admin123'
  }, null, function(err, res) {
    if (res && res.status === 200 && res.data.token) {
      adminToken = res.data.token;
      printResult('Admin login', true);
    } else {
      printResult('Admin login', false);
    }
    
    // Register new user - CORRECTED: expects 200 OR 201
    makeRequest('POST', '/auth/register', {
      email: testEmail,
      password: 'password123'
    }, null, function(err, res) {
      // Accept both 200 and 201 as success
      printResult('User registration', res && (res.status === 200 || res.status === 201));
      
      // User login
      makeRequest('POST', '/auth/login', {
        email: testEmail,
        password: 'password123'
      }, null, function(err, res) {
        if (res && res.status === 200 && res.data.token) {
          playerToken = res.data.token;
          printResult('User login', true);
        } else {
          printResult('User login', false);
        }
        
        // Invalid login
        makeRequest('POST', '/auth/login', {
          email: 'wrong@test.com',
          password: 'wrong'
        }, null, function(err, res) {
          printResult('Invalid login rejection', res && res.status === 401);
          callback();
        });
      });
    });
  });
}

function testDrawManagement(callback) {
  console.log(colors.cyan + '\n🎰 Testing Draw Management' + colors.reset);
  
  // Test unauthorized access
  makeRequest('POST', '/lottery/draws', {
    draw_date: '2026-01-01',
    prize_amount: 5000
  }, null, function(err, res) {
    printResult('Reject draw creation without auth', res && res.status === 401);
    
    // Test non-admin rejection
    makeRequest('POST', '/lottery/draws', {
      draw_date: '2026-01-01',
      prize_amount: 5000
    }, playerToken, function(err, res) {
      printResult('Reject draw creation as player', res && res.status === 403);
      
      // Create draw with unique date
      var futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + Math.floor(Math.random() * 365) + 100);
      var uniqueDate = futureDate.toISOString().split('T')[0];
      
      makeRequest('POST', '/lottery/draws', {
        draw_date: uniqueDate,
        prize_amount: 10000
      }, adminToken, function(err, res) {
        // Accept both 200 and 201 for creation
        if (res && (res.status === 200 || res.status === 201) && res.data.id) {
          drawId = res.data.id;
          printResult('Create draw as admin', true);
        } else {
          printResult('Create draw as admin', false);
        }
        callback();
      });
    });
  });
}

function testBetting(callback) {
  console.log(colors.cyan + '\n🎲 Testing Betting System' + colors.reset);
  
  if (!drawId) {
    console.log(colors.yellow + 'Skipping bet tests - no draw created' + colors.reset);
    callback();
    return;
  }
  
  // Test unauthorized betting
  makeRequest('POST', '/lottery/bets', {
    draw_id: drawId,
    numbers: [1, 2, 3, 4, 5],
    complementary_number: 5
  }, null, function(err, res) {
    printResult('Reject bet without auth', res && res.status === 401);
    
    // Place valid bet
    makeRequest('POST', '/lottery/bets', {
      draw_id: drawId,
      numbers: [5, 12, 23, 34, 45],
      complementary_number: 7
    }, playerToken, function(err, res) {
      printResult('Place valid bet', res && (res.status === 200 || res.status === 201));
      
      // Test duplicate bet prevention
      makeRequest('POST', '/lottery/bets', {
        draw_id: drawId,
        numbers: [1, 2, 3, 4, 5],
        complementary_number: 5
      }, playerToken, function(err, res) {
        printResult('Prevent duplicate bet', res && res.status === 409);
        
        // Test invalid numbers
        makeRequest('POST', '/lottery/bets', {
          draw_id: drawId,
          numbers: [50, 51, 52, 53, 54],
          complementary_number: 5
        }, playerToken, function(err, res) {
          printResult('Validate number range', res && res.status === 400);
          callback();
        });
      });
    });
  });
}

function testHealthChecks(callback) {
  console.log(colors.cyan + '\n🏥 Testing Health Checks' + colors.reset);
  
  // Gateway health
  makeRequest('GET', 'http://localhost:3000/health', null, null, function(err, res) {
    printResult('Gateway health check', res && res.status === 200);
    callback();
  });
}

function printSummary() {
  console.log(colors.yellow + '\n====================================' + colors.reset);
  console.log(colors.yellow + '📊 Test Summary' + colors.reset);
  console.log(colors.yellow + '====================================' + colors.reset);
  console.log('Total Tests: ' + totalTests);
  console.log(colors.green + '✅ Passed: ' + passedTests + colors.reset);
  console.log(colors.red + '❌ Failed: ' + failedTests + colors.reset);
  var successRate = totalTests > 0 ? ((passedTests/totalTests) * 100).toFixed(1) : 0;
  console.log(colors.cyan + 'Success Rate: ' + successRate + '%' + colors.reset);
  
  if (failedTests === 0) {
    console.log(colors.green + '\n🎉 All tests passed! Your system is working perfectly!' + colors.reset);
  } else {
    console.log(colors.yellow + '\n⚠️  ' + failedTests + ' test(s) failed.' + colors.reset);
  }
}

// Run all tests
console.log(colors.yellow + '🚀 Starting Lottery System Test Suite' + colors.reset);
console.log(colors.yellow + '====================================' + colors.reset);

testPublicEndpoints(function() {
  setTimeout(function() {
    testAuthentication(function() {
      setTimeout(function() {
        testDrawManagement(function() {
          setTimeout(function() {
            testBetting(function() {
              setTimeout(function() {
                testHealthChecks(function() {
                  printSummary();
                });
              }, 500);
            });
          }, 500);
        });
      }, 500);
    });
  }, 500);
});