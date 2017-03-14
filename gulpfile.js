var gulp = require('gulp');
var less = require('gulp-less');
var rename = require('gulp-rename');
var foreach = require('gulp-foreach');
var hbs = require('handlebars');
var gulpHandlebars = require('gulp-handlebars-html')(hbs);
var jsonTransform = require('gulp-json-transform');
var swagger = require('gulp-swagger');
var path = require('path');
var MarkdownIt = require('markdown-it');
var gulpMarkdownIt = require('gulp-markdown-it-adapter');
var highlightJs = require('highlightjs');
var concat = require('gulp-concat');
var mdToc = require('markdown-it-toc-and-anchor').default;
var webserver = require('gulp-webserver');
var _ = require('lodash');
var del = require('del');
var merge = require('merge-stream');
var gutil = require('gulp-util');
var argv  = require('minimist')(process.argv);
var rsync = require('gulp-rsync');
var prompt = require('gulp-prompt');
var gulpif = require('gulp-if');
 
// Transform less into css file that is put into dist directory
gulp.task('less', ['clean-dist'], function () {
   return gulp.src('./styles/variables.less')
    .pipe(less({
      paths: [ path.join(__dirname, 'less', 'includes') ]
    }))
    .pipe(gulp.dest('./dist/css'));
});

// Copy html, css, js and image files into dist directory
gulp.task('copy', ['clean-dist'], function(){
  var fa = gulp.src('node_modules/font-awesome/css/font-awesome.min.css')
    .pipe(gulp.dest('dist/css/'));
  var font = gulp.src('node_modules/font-awesome/fonts/*')
    .pipe(gulp.dest('dist/fonts/'));
  var lib = gulp.src([
      'node_modules/jquery/dist/jquery.min.js',
      'node_modules/handlebars/handlebars.min.js',
      'node_modules/bootstrap/dist/js/bootstrap.min.js'])
    .pipe(gulp.dest('dist/js/'));
  var img = gulp.src('content/img/*')
    .pipe(gulp.dest('dist/img/'));

  return merge(fa, font, lib, img);
});

gulp.task('landings', function() {
  return gulp.src('src/*.handlebars')
    .pipe(foreach(function(stream, file){
      return gulp.src(file.path)
        .pipe(gulpHandlebars({}, {
          partialsDirectory: ['./src/partials']
        }))
        .pipe(rename(path.basename(file.path).replace(/\.handlebars$/, '.html')))
        .pipe(gulp.dest('dist'));
    }))
});

gulp.task('hbs', ['clean-dist'], function () {
  gulp.src('./content/akeneo-web-api.yaml')
    .pipe(swagger('akeneo-web-api.json'))
    .pipe(jsonTransform(function(data, file) {
      var templateData = data;
      data.ressources = {};
      _.forEach(data.paths, function(path, pathUri){
        var escapedPathUri = pathUri.replace(/\//g, '_').replace(/{/g, '_').replace(/}/g, '_');
        _.forEach(path, function(operation,verb){
          var escapeTag = operation.tags[0].replace(/\s/g, '');
          if(!data.ressources[escapeTag]){
            data.ressources[escapeTag] = {ressourceName: operation.tags[0], operations: {}};
          }
          var extendedOperation = _.extend(operation, {verb: verb, path: pathUri});
          data.ressources[escapeTag].operations[verb+escapedPathUri] = extendedOperation;
        });
      });
      return gulp.src('src/api-reference/index.handlebars')
          .pipe(gulpHandlebars(templateData, {}))
          .pipe(rename('api-reference-index.html'))
          .pipe(gulp.dest('dist'));
    }));

  gulp.src('./content/akeneo-web-api.yaml')
    .pipe(swagger('akeneo-web-api.json'))
    .pipe(jsonTransform(function(data, file) {
      var templateData = data;
      data.ressources = {};
      _.map(data.definitions,function(definition){
        _.forEach(definition.required, function(requiredProperty){
          definition.properties[requiredProperty].required = true;
        });
        return definition;
      });
      _.forEach(data.paths, function(path, pathUri){
        var escapedPathUri = pathUri.replace(/\//g, '_').replace(/{/g, '_').replace(/}/g, '_');
        _.forEach(path, function(operation,verb){
          var operationId = verb + escapedPathUri;
          var escapeTag = operation.tags[0].replace(/\s/g, '');
          if(!data.ressources[escapeTag]){
            data.ressources[escapeTag] = {ressourceName: operation.tags[0], operations: {}};
          }
          var groupedParameters =_.groupBy(operation.parameters, function(parameter){
            return parameter.in;
          });
          _.map(groupedParameters.body, function(parameter){
            var readOnlyProperties = [];
            _.map(parameter.schema.properties, function(property, propertyName){
              property.default = (property.default === 0) ? '0' :
                (property.default === null) ? 'null' :
                (property.default === true) ? 'true' :
                (property.default === false) ? 'false' :
                (property.default && _.isEmpty(property.default)) ? '[]' : property.default;
              property['x-immutable'] = (verb === 'patch') ? property['x-immutable'] : false;
              if(verb === 'post' && property['x-read-only']){
                readOnlyProperties.push(propertyName);
              }
            });
            _.forEach(parameter.schema.required, function(requiredProperty){
              if(verb !== 'patch'){
                parameter.schema.properties[requiredProperty].required = true;
              } else {
                parameter.schema.properties[requiredProperty].patchRequired = true;
              }
            });
            _.forEach(readOnlyProperties, function(propToDelete){
              delete parameter.schema.properties[propToDelete];
            });
            if(parameter.schema && parameter.schema.example){
              _.forEach(readOnlyProperties, function(propToDelete){
                delete parameter.schema.example[propToDelete];
              });
              var highlightjsExample = parameter.schema['x-examples'] ? 
                highlightJs.highlight('bash', parameter.schema['x-examples']['x-example-1'] + '\n'
                                           + parameter.schema['x-examples']['x-example-2'] + '\n'
                                            + parameter.schema['x-examples']['x-example-3'], true) :
                highlightJs.highlight('json', JSON.stringify(parameter.schema.example, null, 2), true);
              parameter.schema.hljsExample = '<pre class="hljs"><code>' + highlightjsExample.value + '</code></pre>';
            }
            return parameter;
          });

          _.map(operation.responses, function(response, code){
            var status = code.match(/^2.*$/) ? 'success' : 'error';
            response[status] = true;
            response.id = operationId + '_' + code;
            var example = response.examples || ((response.schema) ? response.schema.example : undefined);
            if(example){
              var highlightjsExample = example['x-example-1'] ? 
                highlightJs.highlight('bash', example['x-example-1'] + '\n' + example['x-example-2']+ '\n' + example['x-example-3'], true) : 
                highlightJs.highlight('json', JSON.stringify(example, null, 2), true);
              response.hljsExample = '<pre class="hljs"><code>' + highlightjsExample.value + '</code></pre>';
            }
            return response;
          });
          data.ressources[escapeTag].operations[operationId] = _.extend(operation, {verb: verb, path: pathUri, groupedParameters:groupedParameters});
        });
      });
      return gulp.src('src/api-reference/reference.handlebars')
          .pipe(gulpHandlebars(templateData, {}))
          .pipe(rename('api-reference.html'))
          .pipe(gulp.dest('dist'));
    }));
});

// Transform content written in markdown into html and put it into dist directory
gulp.task('markdownize', ['clean-dist'],function (){
  var optionsMd = {
    html: false,
    xhtmlOut: true,
    typographer: false,
    linkify: false,
    breaks: false,
    highlight: highlight
  };
  var optionsToc = {
    toc: false,
    tocFirstLevel: 2,
    tocLastLevel: 3,
    anchorLink: true,
    anchorLinkSpace: false,
    anchorLinkBefore: true,
    tocClassName: 'table-of-contents'
  };

  var md = new MarkdownIt('default', optionsMd);
  function imageTokenOverride(tokens, idx, options, env, self) {
    return '<img class="img-responsive" alt="'+ tokens[idx].content +'" src="'+ tokens[idx].attrs[0][1] + '"/>';
  }
  md.renderer.rules['image'] = imageTokenOverride;
  md.renderer.rules.table_open = function(tokens, idx) {
    return '<table class="table">';
  };
  md.renderer.rules.heading_open = function(tokens, idx) {
    return '<a class="anchor" id="' + tokens[idx].attrs[0][1] + '"></a>'+
      '<'+tokens[idx].tag+' title-id="' + tokens[idx].attrs[0][1] + '">';
  };

  md.use(mdToc, optionsToc)
    .use(require('markdown-it-container'), 'panel-link', {
      validate: function(params) {
        return params.trim().match(/^panel-link\s+(.*)$/);
      },
      render: function (tokens, idx) {
        var text = tokens[idx].info.trim().match(/^panel-link\s+(.*)\[.*\].*$/);
        var linkTitle = tokens[idx].info.trim().match(/^panel-link\s+.*\[(.*)\].*$/);
        var link = tokens[idx].info.trim().match(/^panel-link\s+.*\((.*)\)$/);
        if (tokens[idx].nesting === 1) {
          // opening tag
          return '<div class="row" style="margin-top: 80px;"><div class="col-sm-offset-3 col-sm-6">' + 
            '<div class="panel panel-default panel-landing-page panel-clickable">'+
              '<a href="' + md.utils.escapeHtml(link[1]) + '">' + 
                '<div class="panel-body">' +
                  '<p>'+ md.utils.escapeHtml(text[1]) + '</p>'+
                  '<p>'+ md.utils.escapeHtml(linkTitle[1]) + '</p>';
        } else {
          // closing tag
          return '</div></a></div></div></div>\n';
        }
      }
    })
    .use(require('markdown-it-container'), 'danger', {
      validate: function(params) {
        return params.trim().match(/^danger(.*)$/);
      },
      render: function (tokens, idx) {
        return (tokens[idx].nesting === 1) ? '<div class="alert alert-danger">' : '</div>\n';
      }
    })
    .use(require('markdown-it-container'), 'warning', {
      validate: function(params) {
        return params.trim().match(/^warning(.*)$/);
      },
      render: function (tokens, idx) {
        return (tokens[idx].nesting === 1) ? '<div class="alert alert-warning">' : '</div>\n';
      }
    })
    .use(require('markdown-it-container'), 'info', {
      validate: function(params) {
        return params.trim().match(/^info(.*)$/);
      },
      render: function (tokens, idx) {
        return (tokens[idx].nesting === 1) ? '<div class="alert alert-info">' : '</div>\n';
      }
    })
    .use(require('markdown-it-container'), 'dodont', {
      validate: function(params) {
        return params.trim().match(/^dodont(.*)$/);
      },
      render: function (tokens, idx) {
        return (tokens[idx].nesting === 1) ? '<div class="row">' : 
            '</div>\n';
      }
    })
    .use(require('markdown-it-container'), 'dont', {
      validate: function(params) {
        return params.trim().match(/^dont(.*)$/);
      },
      render: function (tokens, idx) {
        var text = tokens[idx].info.trim().match(/^dont\s+(.*).*$/);
        return (tokens[idx].nesting === 1) ? 
          '<div class="col-xs-6">'+
            '<div class="panel panel-danger" data-text="' +  md.utils.escapeHtml(text[1]) + '">'+
              '<div class="panel-body">' : 
            '<strong>DON\'T</strong></div>\n</div>\n</div>\n';
      }
    })
    .use(require('markdown-it-container'), 'do', {
      validate: function(params) {
        return params.trim().match(/^do(.*)$/);
      },
      render: function (tokens, idx) {
        var text = tokens[idx].info.trim().match(/^do\s+(.*).*$/);
        return (tokens[idx].nesting === 1) ? 
          '<div class="col-xs-6">'+
            '<div class="panel panel-success" data-text="' +  md.utils.escapeHtml(text[1]) + '">'+
              '<div class="panel-body">' : 
            '<strong>DO</strong></div>\n</div>\n</div>\n';
      }
    });
        

    return gulp.src([
        'content/introduction.md',
        'content/overview.md',
        'content/security.md',
        'content/resources.md',
        'content/responses.md',
        'content/pagination.md',
        'content/update.md',
        'content/filter.md'
      ])
      .pipe(concat('content.md'))
      .pipe(gulpMarkdownIt(md))
      .pipe(gulp.dest('./dist/content'));
  }
);

function highlight(str, lang) {
  if (lang && highlightJs.getLanguage(lang)) {
    try {
      return '<pre class="hljs"><code>' +
        highlightJs.highlight(lang, str, true).value +
          '</code></pre>';
    } catch (__) {}
  }
  return '<pre class="hljs"><code>' + str + '</code></pre>';
}

// Clean dist directory
gulp.task('clean-dist', function () {
  return del(['dist/*']);
});

// Watch if mardown, less, html or image files have changed
// so as to relaunch the build into dist directory
// Should be used for dev purpose
gulp.task('watch', ['create-dist'], function() {
  gulp.watch('content/*.md', ['create-dist']);
  gulp.watch('styles/*.less', ['create-dist']);
  gulp.watch('src/*.handlebars', ['create-dist']);
  gulp.watch('src/api-reference/*.handlebars',['create-dist']);
  gulp.watch('content/img/*', ['create-dist']);
  gulp.watch('content/*.yaml', ['create-dist']);
});

// Launch a server with dist directory exposed on it
// Should be used for dev purpose
gulp.task('launch-webserver', ['create-dist'], function() {
  return gulp.src('dist')
    .pipe(webserver({
      livereload: true,
      directoryListing: false,
      open: true
    }));
});

gulp.task('deploy', function() {
  // Dirs and Files to sync
  rsyncPaths = ['./dist/*' ];
  
  // Default options for rsync
  rsyncConf = {
    progress: true,
    incremental: true,
    relative: false,
    emptyDirectories: true,
    recursive: true,
    clean: true,
    exclude: [],
  };
  
  if (argv.staging) {
    rsyncConf.hostname = 'api-staging'; // hostname
    rsyncConf.username = 'akeneo'; // ssh username
    rsyncConf.destination = '/var/www/html'; // path where uploaded files go
  } else if (argv.production) {
    rsyncConf.hostname = 'api'; // hostname
    rsyncConf.username = 'akeneo'; // ssh username
    rsyncConf.destination = '/var/www/html'; // path where uploaded files go
  } else {
    throwError('deploy', gutil.colors.red('Missing or invalid target'));
  }
  
  return gulp.src(rsyncPaths)
  .pipe(gulpif(
      argv.production, 
      prompt.confirm({
        message: 'Heads Up! Are you SURE you want to push to PRODUCTION?',
        default: false
      })
  ))
  .pipe(rsync(rsyncConf));

});

function throwError(taskName, msg) {
  throw new gutil.PluginError({
      plugin: taskName,
      message: msg
    });
}

// Build the documentation is dist directory
gulp.task('create-dist', [
  'less',
  'copy',
  'hbs',
  'landings',
  'markdownize'
]);

// Main task that should be used for development purpose
gulp.task('serve', [
  'launch-webserver',
  'watch'
]);
