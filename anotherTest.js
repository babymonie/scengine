const url = "https://wimg.com/thumbnails/2926/thumbnail_9c5c2738c505044ae5204ab3d8d93cf6.jpg?10685810";
const pattern = /thumbnails\/(\d+)\/thumbnail_(.*?)\.jpg.*/;
const replacement = "images/$1/$2.jpeg";
console.log(url.replace(pattern, replacement));
