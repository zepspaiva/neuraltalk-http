var express = require('express');
var app = express();
var flash = require('connect-flash');
var multipart = require('connect-multiparty');
var multipartMiddleware = multipart({ maxFieldsSize: 50*1024*1024 });

var swig = require('swig');
var morgan = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var session = require('express-session');

var fs = require('fs');
var path = require('path');
var child_process = require('child_process');
var spawn = child_process.spawn;
var execFileSync = child_process.execFileSync;
const Decompress = require('decompress');
var fstream = require('fstream');

var async = require('async');
var uuid = require('uuid');

var http = require('http');

var PORT = 8080;
var TRAIN_DIR = './train';
var QUEUE_DIR = './queue';
var RESULTS_DIR = './results';

var NEURAL_TALK_2_DIR = '../neuraltalk2';
var NEURAL_TALK_2_DIR_BACK = '../neuraltalk-http/';
var NEURAL_TALK_2_MODEL_FILE = 'model_id1-501-1448236541.t7_cpu.t7';
var NEURAL_TALK_2_USE_GPU = false;

var NEURAL_TALK_2_FILENAME_REGEX = /cp.*\/(.*)\".*\/img([0-9]*)\.jpg.*/gi;
var NEURAL_TALK_2_RESUTL_REGEX = /image\s([0-9]*)\:\s([a-z ]*).*/gi;

if (!fs.existsSync(TRAIN_DIR)) fs.mkdirSync(TRAIN_DIR);
if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR);
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR);

var deletefolder = function(path) {
  if( fs.existsSync(path) ) {
    fs.readdirSync(path).forEach(function(file,index){
      var curPath = path + "/" + file;
      if(fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
};

function searchimages(query, callback) {

	http.get({
		
		host: 'www.google.com.br',
    	headers: {'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/47.0.2526.73 Safari/537.36'},
    	path: '/search?q=sheet+of+paper+over+desk&tbm=isch&gws_rd=ssl#'

	}, function(res) {
	    
	    console.log("Got response: " + res.statusCode);

	    var content = '';
	    res.on('data', function(chunk) {
	        content += chunk;
	    });

	    res.on('end', function() {
	        console.log('end');
	        console.log(content.length);

	        var matches = content.match(/tbnid\=([^\&]+)/gi);

	        if (matches) {
		     
	        	var tbnidoffset = "tbnid=".length;

		        for (m = 0; m < matches.length; m++) {
		        	var tbnid = matches[m].substr(tbnidoffset);
		        	var regex = "\\[\\"" + tbnid.replace(/\-/g, '\\-').replace('/\:/g', '\\:') + "\"\,\"([a-z0-9]*\"\]";
		        	console.log(regex);
		        	var base64match = content.match(new RegExp(regex, "gi"));
		        	
		        }

		    }

	        if (callback) callback(null, []);

	    });

	});

}

function runneuraltalk2(modelpath, imagepath, imagecount, imagesfiles, queuename, usegpu, callback) {

	var gpuarg = [];
	if (!usegpu) gpuarg = ['-gpuid', '-1'];

	var args = ['eval.lua', '-model', modelpath, '-image_folder', NEURAL_TALK_2_DIR_BACK + imagepath, '-num_images', imagecount];
	for (g in gpuarg)
		args.push(gpuarg[g]);

	var originalfilename = -1;
	var results = [];

	var proc = spawn("th", args, { cwd: NEURAL_TALK_2_DIR });

	proc.stdout.on('data', function (data) {

		var match = NEURAL_TALK_2_FILENAME_REGEX.exec(data);
		if (match) {

			originalfilename = match[1];

		}

		var match = NEURAL_TALK_2_RESUTL_REGEX.exec(data);
		if (match) {

			var sec;
			var secm = /([0-9]*)\.[a-z]*/gi.exec(originalfilename);
			if (secm && secm.length > 1) sec = parseInt(secm[1]);

			var caption = match[2];

			var basefilename = originalfilename.substr(0, originalfilename.length - path.extname(originalfilename).length);
			var jsonpath = imagepath + '/' + basefilename + '.json';
			var jsonobj = {
				sec: sec,
				filename: originalfilename,
				caption: caption
			};

			fs.writeFileSync(jsonpath, JSON.stringify(jsonobj));

			results.push({ imagepath: imagepath + originalfilename, jsonpath: jsonpath });

		}

	});

	proc.stderr.on('data', function (data) {
		console.log('stderr: ' + data);
	});

	proc.on('close', function(code) {

		if (callback) callback(results);

	});

}

function ntstandalone(foldername, filepath, callback) {

	var tempfoldername = foldername + "_" + (new Date()).getTime();
	var tempfolder = QUEUE_DIR + "/" + tempfoldername;
	var filename = path.basename(filepath);
	var tempimgpath = tempfolder + "/" + filename;

	fs.mkdirSync(tempfolder);
	fs.renameSync(filepath, tempimgpath);

	runneuraltalk2(NEURAL_TALK_2_MODEL_FILE, tempfolder, 1, [filename], foldername, NEURAL_TALK_2_USE_GPU, function(results) {

		if (results.length > 0) {

			var result0 = results[0];
			if (callback) callback(result0.imagepath, result0.jsonpath);

		}

	});

}

function ntfolder(foldername, folderpath, callback) {

	var filenames = fs.readdirSync(folderpath).filter(function(file) {
		return !fs.statSync(path.join(folderpath, file)).isDirectory();
	});

	runneuraltalk2(NEURAL_TALK_2_MODEL_FILE, folderpath, filenames.length, filenames, foldername, NEURAL_TALK_2_USE_GPU, function(results) {

		if (callback) callback(results);

	});

}

function autoorientimage(filepath, callback) {

	var proc = spawn("convert", [filepath, '-auto-orient', filepath]);

	proc.stdout.on('data', function (data) {
		console.log('stdout: ' + data);
	});

	proc.stderr.on('data', function (data) {
		console.log('stderr: ' + data);
	});

	proc.on('close', function(code) {
		if (callback) callback();
	});

}

function msToTime(duration) {
    
    var milliseconds = parseInt((duration%1000))
        , seconds = parseInt((duration/1000)%60)
        , minutes = parseInt((duration/(1000*60))%60)
        , hours = parseInt((duration/(1000*60*60))%24);

    hours = (hours < 10) ? "0" + hours : hours;
    minutes = (minutes < 10) ? "0" + minutes : minutes;
    seconds = (seconds < 10) ? "0" + seconds : seconds;
    milliseconds = (milliseconds < 10) ? "0" + milliseconds : milliseconds;
    milliseconds = (milliseconds < 100) ? "0" + milliseconds : milliseconds;

    return hours + ":" + minutes + ":" + seconds + "." + milliseconds;

}

function generatesrt(folderpath, callback) {

	var jsonfilenames = fs.readdirSync(folderpath).filter(function(file) {
		return !fs.statSync(path.join(folderpath, file)).isDirectory() && path.extname(file) === ".json";
	});

	var subtitlepath = folderpath + '/subtitles.srt';
	var subtitles = [];

	for (f in jsonfilenames) {

		var jsonobj = JSON.parse(fs.readFileSync(folderpath + "/" + jsonfilenames[f]));

		var subi = parseInt(f) + 1;
		var start = msToTime(jsonobj.sec*1000);
		var end = msToTime(jsonobj.sec*1000 + 999);
		var caption = jsonobj.caption;

		subtitles.push({ sec: jsonobj.sec, start: start, end: end, caption: caption });

	}

	subtitles = subtitles.sort(function(a,b) {
		return a.sec > b.sec ? 1: -1;
	});

	var subtitlescontent = '';
	var subi = 0;

	for (s in subtitles) {

		var subtitle = subtitles[s];
		subi++;

		subtitlescontent += subi + '\n' + subtitle.start + ' --> ' + subtitle.end + '\n' + subtitle.caption + '\n\n';

	}

	fs.writeFileSync(subtitlepath, subtitlescontent);
	console.log('Saved ' + subtitlepath);

	if (callback) callback();

}

function generategif(folderpath, callback) {

	var jsonfilenames = fs.readdirSync(folderpath).filter(function(file) {
		return !fs.statSync(path.join(folderpath, file)).isDirectory() && path.extname(file) === ".json";
	});

	var subtitlepath = folderpath + '/subtitles.srt';
	var subtitles = [];

	for (f in jsonfilenames) {

		var jsonobj = JSON.parse(fs.readFileSync(folderpath + "/" + jsonfilenames[f]));

		var subi = parseInt(f) + 1;
		var start = msToTime(jsonobj.sec*1000);
		var end = msToTime(jsonobj.sec*1000 + 999);
		var caption = jsonobj.caption;

		subtitles.push({ sec: jsonobj.sec, start: start, end: end, caption: caption, filename: jsonobj.filename });

	}

	subtitles = subtitles.sort(function(a,b) {
		return a.sec > b.sec ? 1: -1;
	});

	var ext = '.jpg';


	async.mapSeries(subtitles, function(sub, callback) {

		ext = path.extname(sub.filename);

		var proc = spawn("convert", [sub.filename, '-gravity', 'south', '-stroke', "'#000C'", '-strokewidth', '2', '-annotate', '0', "'" + sub.caption + "'", '-pointsize', '30',  '-stroke', 'none', '-fill', 'white', '-annotate', '0', "'" + sub.caption + "'", '-pointsize', '30', sub.filename], { cwd: folderpath });

		proc.on('close', function(code) {

			callback();

		});

	}, function() {

		var proc = spawn("convert", ['-delay', '100', '-loop', '0', '*' + ext, 'animated.gif'], { cwd: folderpath });

		proc.on('close', function(code) {

			console.log('Saved animated.gif');
			if (callback) callback();

		});

	});

}

// ===

app.use(morgan('dev'));
app.use(cookieParser());
app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

app.set('view cache', false);
swig.setDefaults({ cache: false });

app.use(express.static(__dirname + '/web'));
app.engine('html', swig.renderFile);

app.set('view engine', 'html');
app.set('views', __dirname + '/web/swig');

app.use(session({ secret: 'ilovescotchscotchyscotchscotch' }));
app.use(flash());

app.get('/train', function(req, res) {

	var s = req.query.s;

	searchimages(s, function(err, images) {
		if (err) console.log(err);

		console.log(images);
		res.status(200).send({ success: true });
	})

});

app.get('/', function(req, res) {

	var f = req.query.f;
	if (!f) f = uuid.v4().replace(/\\/g, '');

	res.redirect('/image?f=' + f);

});

app.get('/image', function(req, res) {

	var f = req.query.f
	res.render('image.html', { f: f });

});

app.get('/video', function(req, res) {

	var f = req.query.f
	res.render('video.html', { f: f });

});

app.get('/img/:foldername/:filename', function(req, res) {

	var foldername = req.params.foldername;
	var filename = req.params.filename;
	var filepath = RESULTS_DIR + "/" + foldername + "/" + filename;

	fs.createReadStream(filepath).pipe(res);

});

app.get('/srt/:foldername', function(req, res) {

	var foldername = req.params.foldername;
	var filepath = RESULTS_DIR + "/" + foldername + "/subtitles.srt";
	var filename = foldername + '.srt';

	res.setHeader('Content-disposition', 'attachment; filename=' + filename);
	fs.createReadStream(filepath).pipe(res);

});

app.get('/gif/:foldername', function(req, res) {

	var foldername = req.params.foldername;
	var filepath = QUEUE_DIR + "/" + foldername + "/animated.gif";
	var filename = foldername + '.gif';

	res.setHeader('Content-disposition', 'attachment; filename=' + filename);
	fs.createReadStream(filepath).pipe(res);

});

app.post('/upload', multipartMiddleware, function(req, res) {

	var f = req.body.f;
	var base64Images = req.body.imageData;

	if (base64Images) {

		base64Images = JSON.parse(base64Images);

		var folderid = f + "_" + (new Date()).getTime();

		var folderpath = QUEUE_DIR + "/" + folderid;
		fs.mkdirSync(folderpath);

		for (b in base64Images) {

			var base64Image = base64Images[b];
			base64Data = base64Image.base64;

			var base64Header = base64Data.substr(0, base64Data.indexOf("base64,") + "base64,".length);
			var ext = base64Header.match(/^data:image\/([a-z]+);base64,/)[1];
			if (ext === "jpeg") ext = "jpg";

			base64Data = base64Data.substr(base64Header.length);

			filepath = folderpath + '/' + b + '.' + ext
			fs.writeFileSync(filepath, base64Data, 'base64');

		}

		ntfolder(f, folderpath, function(results) {

    		generatesrt(folderpath, function() {

    			generategif(folderpath, function() {

    				res.status(200).send({ success: true, fid: folderid });

    			});

    		});

		});

		/*

		var base64Header = base64Data.substr(0, base64Data.indexOf("base64,") + "base64,".length);
		var ext = base64Header.match(/^data:image\/([a-z]+);base64,/)[1];
		if (ext === "jpeg") ext = "jpg";

		base64Data = base64Data.substr(base64Header.length);

		var filepath = QUEUE_DIR + "/" + f + "_" + (new Date()).getTime() + "." + ext;

		fs.writeFile(filepath, base64Data, 'base64', function(err) {
			if (err) res.status(200).send({ success: false });

			ntstandalone(f, filepath, function(imagefilepath, jsonfilepath) {

				autoorientimage(imagefilepath, function() {

					var resultobj = JSON.parse(fs.readFileSync(jsonfilepath));
					res.status(200).send({ success: true, image: imagefilepath.substr(RESULTS_DIR.length), caption: resultobj.caption });
					
				});

			});

		});*/

	}/* else {

		return;

		base64Data = req.body.zipData;

		if (base64Data) {

			var base64Header = base64Data.substr(0, base64Data.indexOf("base64,") + "base64,".length);
			base64Data = base64Data.substr(base64Header.length);
			
			var filebasename = f + "_" + (new Date()).getTime();
			var filepath = QUEUE_DIR + "/" + filebasename + ".zip";

			fs.writeFile(filepath, base64Data, 'base64', function(err) {
				if (err) res.status(200).send({ success: false });
				
				var unzippath = RESULTS_DIR + "/" + filebasename;
				fs.mkdirSync(unzippath);

				new Decompress({mode: '755'})
				    .src(filepath)
				    .dest(unzippath)
				    .use(Decompress.zip({ strip: 1 }))
				    .run(function() {

				    	ntfolder(f, unzippath, function(results) {

				    		generatesrt(unzippath, function() {

				    			res.status(200).send({ success: true, srt: filebasename });

				    		});

						});

				    });

			});

		}

	}*/

});

app.listen(PORT);
console.log('The magic happens on port ' + PORT);