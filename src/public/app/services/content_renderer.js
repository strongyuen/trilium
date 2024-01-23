import renderService from "./render.js";
import protectedSessionService from "./protected_session.js";
import protectedSessionHolder from "./protected_session_holder.js";
import libraryLoader from "./library_loader.js";
import openService from "./open.js";
import froca from "./froca.js";
import utils from "./utils.js";
import linkService from "./link.js";
import treeService from "./tree.js";
import FNote from "../entities/fnote.js";
import FAttachment from "../entities/fattachment.js";
import imageContextMenuService from "../menus/image_context_menu.js";

let idCounter = 1;

/**
 * @param {FNote|FAttachment} entity
 * @param {object} options
 * @return {Promise<{type: string, $renderedContent: jQuery}>}
 */
async function getRenderedContent(entity, options = {}) {
    options = Object.assign({
        tooltip: false
    }, options);

    const type = getRenderingType(entity);
    // attachment supports only image and file/pdf/audio/video

    const $renderedContent = $('<div class="rendered-content">');

    if (type === 'text') {
        await renderText(entity, $renderedContent);
    }
    else if (type === 'code') {
        await renderCode(entity, $renderedContent);
    }
    else if (type === 'image' || type === 'canvas') {
        renderImage(entity, $renderedContent, options);
    }
    else if (!options.tooltip && ['file', 'pdf', 'audio', 'video'].includes(type)) {
        renderFile(entity, type, $renderedContent);
    }
    else if (type === 'mermaid') {
        await renderMermaid(entity, $renderedContent);
    }
    else if (type === 'render') {
        const $content = $('<div>');

        await renderService.render(entity, $content, this.ctx);

        $renderedContent.append($content);
    }
    else if (!options.tooltip && type === 'protectedSession') {
        const $button = $(`<button class="btn btn-sm"><span class="bx bx-log-in"></span> Enter protected session</button>`)
            .on('click', protectedSessionService.enterProtectedSession);

        $renderedContent.append(
            $("<div>")
                .append("<div>This note is protected and to access it you need to enter password.</div>")
                .append("<br/>")
                .append($button)
        );
    }
    else if (entity instanceof FNote) {
        $renderedContent.append(
            $("<div>")
                .css("display", "flex")
                .css("justify-content", "space-around")
                .css("align-items", "center")
                .css("height", "100%")
                .css("font-size", "500%")
                .append($("<span>").addClass(entity.getIcon()))
        );
    }

    if (entity instanceof FNote) {
        $renderedContent.addClass(entity.getCssClass());
    }

    return {
        $renderedContent,
        type
    };
}

/** @param {FNote} note */
async function renderText(note, $renderedContent) {
    // entity must be FNote
    const blob = await note.getBlob();

    if (!utils.isHtmlEmpty(blob.content)) {
        $renderedContent.append($('<div class="ck-content">').html(blob.content));

        if ($renderedContent.find('span.math-tex').length > 0) {
            await libraryLoader.requireLibrary(libraryLoader.KATEX);

            renderMathInElement($renderedContent[0], {trust: true});
        }

        const getNoteIdFromLink = el => treeService.getNoteIdFromUrl($(el).attr('href'));
        const referenceLinks = $renderedContent.find("a.reference-link");
        const noteIdsToPrefetch = referenceLinks.map(el => getNoteIdFromLink(el));
        await froca.getNotes(noteIdsToPrefetch);

        for (const el of referenceLinks) {
            await linkService.loadReferenceLinkTitle($(el));
        }
    } else {
        await renderChildrenList($renderedContent, note);
    }
}

/** @param {FNote} note */
async function renderCode(note, $renderedContent) {
    const blob = await note.getBlob();

    $renderedContent.append($("<pre>").text(blob.content));
}

function renderImage(entity, $renderedContent, options = {}) {
    const encodedTitle = encodeURIComponent(entity.title);

    let url;

    if (entity instanceof FNote) {
        url = `api/images/${entity.noteId}/${encodedTitle}?${Math.random()}`;
    } else if (entity instanceof FAttachment) {
        url = `api/attachments/${entity.attachmentId}/image/${encodedTitle}?${entity.utcDateModified}">`;
    }

    $renderedContent // styles needed for the zoom to work well
        .css('display', 'flex')
        .css('align-items', 'center')
        .css('justify-content', 'center');

    const $img = $("<img>")
        .attr("src", url)
        .attr("id", "attachment-image-" + idCounter++)
        .css("max-width", "100%");

    $renderedContent.append($img);

    if (options.imageHasZoom) {
        libraryLoader.requireLibrary(libraryLoader.WHEEL_ZOOM).then(() => {
            WZoom.create(`#${$img.attr("id")}`, {
                maxScale: 50,
                speed: 1.3,
                zoomOnClick: false
            });
        });
    }

    imageContextMenuService.setupContextMenu($img);
}

function renderFile(entity, type, $renderedContent) {
    let entityType, entityId;

    if (entity instanceof FNote) {
        entityType = 'notes';
        entityId = entity.noteId;
    } else if (entity instanceof FAttachment) {
        entityType = 'attachments';
        entityId = entity.attachmentId;
    } else {
        throw new Error(`Can't recognize entity type of '${entity}'`);
    }

    const $content = $('<div style="display: flex; flex-direction: column; height: 100%;">');

    if (type === 'pdf') {
        const $pdfPreview = $('<iframe class="pdf-preview" style="width: 100%; flex-grow: 100;"></iframe>');
        $pdfPreview.attr("src", openService.getUrlForDownload(`api/${entityType}/${entityId}/open`));

        $content.append($pdfPreview);
    } else if (type === 'audio') {
        const $audioPreview = $('<audio controls></audio>')
            .attr("src", openService.getUrlForDownload(`api/${entityType}/${entityId}/open-partial`))
            .attr("type", entity.mime)
            .css("width", "100%");

        $content.append($audioPreview);
    } else if (type === 'video') {
        const $videoPreview = $('<video controls></video>')
            .attr("src", openService.getUrlForDownload(`api/${entityType}/${entityId}/open-partial`))
            .attr("type", entity.mime)
            .css("width", "100%");

        $content.append($videoPreview);
    }

    if (entityType === 'notes') {
        // TODO: we should make this available also for attachments, but there's a problem with "Open externally" support
        //       in attachment list
        const $downloadButton = $('<button class="file-download btn btn-primary" type="button">Download</button>');
        const $openButton = $('<button class="file-open btn btn-primary" type="button">Open</button>');

        $downloadButton.on('click', () => openService.downloadFileNote(entity.noteId));
        $openButton.on('click', () => openService.openNoteExternally(entity.noteId, entity.mime));
        // open doesn't work for protected notes since it works through a browser which isn't in protected session
        $openButton.toggle(!entity.isProtected);

        $content.append(
            $('<div style="display: flex; justify-content: space-evenly; margin-top: 5px;">')
                .append($downloadButton)
                .append($openButton)
        );
    }

    $renderedContent.append($content);
}

async function renderMermaid(note, $renderedContent) {
    await libraryLoader.requireLibrary(libraryLoader.MERMAID);

    const blob = await note.getBlob();
    const content = blob.content || "";

    $renderedContent
        .css("display", "flex")
        .css("justify-content", "space-around");

    const documentStyle = window.getComputedStyle(document.documentElement);
    const mermaidTheme = documentStyle.getPropertyValue('--mermaid-theme');

    mermaid.mermaidAPI.initialize({startOnLoad: false, theme: mermaidTheme.trim(), securityLevel: 'antiscript'});

    try {
        const {svg} = await mermaid.mermaidAPI.render("in-mermaid-graph-" + idCounter++, content);

        $renderedContent.append($(svg));
    } catch (e) {
        const $error = $("<p>The diagram could not displayed.</p>");

        $renderedContent.append($error);
    }
}

/**
 * @param {jQuery} $renderedContent
 * @param {FNote} note
 * @returns {Promise<void>}
 */
async function renderChildrenList($renderedContent, note) {
    $renderedContent.css("padding", "10px");
    $renderedContent.addClass("text-with-ellipsis");

    let childNoteIds = note.getChildNoteIds();

    if (childNoteIds.length > 10) {
        childNoteIds = childNoteIds.slice(0, 10);
    }

    // just load the first 10 child notes
    const childNotes = await froca.getNotes(childNoteIds);

    for (const childNote of childNotes) {
        $renderedContent.append(await linkService.createLink(`${note.noteId}/${childNote.noteId}`, {
            showTooltip: false,
            showNoteIcon: true
        }));

        $renderedContent.append("<br>");
    }
}

function getRenderingType(entity) {
    let type = entity.type || entity.role;
    const mime = entity.mime;

    if (type === 'file' && mime === 'application/pdf') {
        type = 'pdf';
    } else if (type === 'file' && mime.startsWith('audio/')) {
        type = 'audio';
    } else if (type === 'file' && mime.startsWith('video/')) {
        type = 'video';
    }

    if (entity.isProtected) {
        if (protectedSessionHolder.isProtectedSessionAvailable()) {
            protectedSessionHolder.touchProtectedSession();
        }
        else {
            type = 'protectedSession';
        }
    }

    return type;
}

export default {
    getRenderedContent
};
