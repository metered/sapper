(function() {
	let source;
	let nonce;

	function check() {
		if (typeof module === 'undefined') return;

		if (module.hot.status() === 'idle') {
			module.hot.check(true).then(modules => {
				console.log(`[SAPPER] applied HMR update`);
			});
		}
	}

	return function connect(port) {
		if (source || !window.EventSource) return;

		const url = port ?
			`http://${window.location.hostname}:${port}/__sapper__` :
			`http://${window.location.host}/__sapper__`
		source = new EventSource(url);

		window.source = source;

		source.onopen = function(event) {
			console.log(`[SAPPER] dev client connected`);
		};

		source.onerror = function(error) {
			console.error(error);
		};

		source.onmessage = function(event) {
			const data = JSON.parse(event.data);
			if (!data) return; // just a heartbeat

			if (data.nonce && !nonce) {
				nonce = data.nonce;
			}

			if (data.nonce !== nonce || data.action === 'reload') {
				window.location.reload();
			}

			if (data.status === 'completed') {
				check();
			}
		};

		// Close the event source before the window is unloaded to prevent an error
		// ("The connection was interrupted while the page was loading.") in Firefox
		// when the page is reloaded.
		window.addEventListener('beforeunload', function() {
			source.close();
		});
	}
})()