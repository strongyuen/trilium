docker run -itd --name note-server --restart=always -v /web/node.tcgoidc.com/data:/home/node/trilium-data -p 127.0.0.1:8080:8080 trilium:0.63.1-beta
